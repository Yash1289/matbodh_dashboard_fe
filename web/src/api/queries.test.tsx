import { QueryClient, QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import runRunning from "../test/fixtures/run_running.json";
import runScoreboard from "../test/fixtures/run_scoreboard_done.json";
import runPartial from "../test/fixtures/run_scoreboard_partial.json";
import states from "../test/fixtures/states.json";
import templates from "../test/fixtures/templates_pulse.json";
import { createQueryClient } from "../App";
import { useCardPlan, useCardRun, useStates, useTemplates } from "./queries";
import type { RunStatus, StateContext } from "./types";

const asRun = (v: unknown) => v as RunStatus;
const RUNNING = asRun(runRunning);
const DONE = asRun(runScoreboard);
const PARTIAL = asRun(runPartial);

const CARD = "pulse.party_scoreboard";
const ctxA: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["o1", "o2"], compare_round: "o1",
  anchor_round: "o2", version_mode: "extrapolated", geo_scope: "state",
};
const ctxB: StateContext = { ...ctxA, rounds: ["o2"], compare_round: null };

type Reply = [number, unknown] | Promise<[number, unknown]>;
type Handler = (path: string, method: string, body: unknown) => Reply;

function stubFetch(handler: Handler) {
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
    const [status, json] = await handler(String(input).replace(/^\/api/, ""), init?.method ?? "GET", body);
    return new Response(JSON.stringify(json), { status });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const count = (f: ReturnType<typeof stubFetch>, method: string, prefix: string) =>
  f.mock.calls.filter(([u, i]) => (i?.method ?? "GET") === method && String(u).startsWith(`/api${prefix}`)).length;

/** POST /cards/run answers run ids from `ids` in order; GET /runs/{id} answers from `runs[id]` in order (last repeats). */
function runServer(ids: string[], runs: Record<string, Reply[]>): Handler {
  let next = 0;
  const seen: Record<string, number> = {};
  return (path, method) => {
    if (method === "POST" && path === "/cards/run") return [200, { run_id: ids[next++] }];
    const id = path.replace(/^\/runs\//, "");
    const queue = runs[id] ?? [[404, { detail: `unknown run '${id}'` }]];
    const i = seen[id] ?? 0;
    seen[id] = i + 1;
    return queue[Math.min(i, queue.length - 1)];
  };
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCardRun", () => {
  it("polls until done", async () => {
    const f = stubFetch(runServer(["r1"], { r1: [[200, RUNNING], [200, DONE]] }));
    const { result } = renderHook(() => useCardRun(CARD, ctxA, true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status?.state).toBe("running"));
    expect(result.current.current).toBeNull();
    await tick(1500);
    await waitFor(() => expect(result.current.status?.state).toBe("done"));
    expect(result.current.current).toEqual(DONE.result);
    const gets = count(f, "GET", "/runs/");
    expect(gets).toBe(2);
    await tick(5000);
    expect(count(f, "GET", "/runs/")).toBe(gets);
    expect(count(f, "POST", "/cards/run")).toBe(1);
  });

  it("a finished run is not fetched again on focus or reconnect", async () => {
    const f = stubFetch(runServer(["r1"], { r1: [[200, DONE]] }));
    const { result } = renderHook(() => useCardRun(CARD, ctxA, true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status?.state).toBe("done"));
    const gets = count(f, "GET", "/runs/");
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await tick(3000);
    expect(count(f, "GET", "/runs/")).toBe(gets);
    expect(result.current.current).toEqual(DONE.result);
  });

  it("a failed run is never current and stops polling", async () => {
    // Synthetic: a failed status that still carries a result must not be shown.
    const FAILED: RunStatus = { ...PARTIAL, state: "failed" };
    const f = stubFetch(runServer(["r1"], { r1: [[200, RUNNING], [200, FAILED]] }));
    const { result } = renderHook(() => useCardRun(CARD, ctxA, true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status?.state).toBe("running"));
    await tick(1500);
    await waitFor(() => expect(result.current.status?.state).toBe("failed"));
    expect(result.current.current).toBeNull();
    expect(result.current.isStale).toBe(false);
    expect(result.current.status?.errors).toEqual(PARTIAL.errors);
    await tick(5000);
    expect(count(f, "GET", "/runs/")).toBe(2);
  });

  it("result of an older context is marked stale", async () => {
    stubFetch(runServer(["rA", "rB"], { rA: [[200, DONE]], rB: [[200, RUNNING], [200, PARTIAL]] }));
    const { result, rerender } = renderHook(({ ctx }) => useCardRun(CARD, ctx, true), {
      wrapper: wrapper(), initialProps: { ctx: ctxA },
    });
    await waitFor(() => expect(result.current.current).toEqual(DONE.result));
    expect(result.current.isStale).toBe(false);
    expect(result.current.previous).toBeNull();

    rerender({ ctx: ctxB });
    expect(result.current.current).toBeNull();
    expect(result.current.previous).toEqual(DONE.result);
    expect(result.current.isStale).toBe(true);
    await waitFor(() => expect(result.current.status?.state).toBe("running"));
    expect(result.current.isStale).toBe(true);

    await tick(1500);
    await waitFor(() => expect(result.current.status?.state).toBe("partial"));
    expect(result.current.current).toEqual(PARTIAL.result);
    expect(result.current.previous).toBeNull();
    expect(result.current.isStale).toBe(false);
  });

  it("404 on poll restarts the run once", async () => {
    // Each run is seen running, then forgotten by the backend (404).
    const gone: Reply = [404, { detail: "unknown run" }];
    const f = stubFetch(runServer(["r1", "r2"], { r1: [[200, RUNNING], gone], r2: [[200, RUNNING], gone] }));
    const { result } = renderHook(() => useCardRun(CARD, ctxA, true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status?.state).toBe("running"));
    await tick(1500);
    await waitFor(() => expect(count(f, "POST", "/cards/run")).toBe(2));
    expect(result.current.error).toBeNull();
    await tick(1500);
    await waitFor(() => expect(result.current.error?.status).toBe(404));
    expect(count(f, "GET", "/runs/r1")).toBe(2);
    expect(count(f, "GET", "/runs/r2")).toBe(2);
    await tick(5000);
    expect(count(f, "POST", "/cards/run")).toBe(2);
    expect(count(f, "GET", "/runs/")).toBe(4);
  });

  it("422 on start surfaces backend errors", async () => {
    const errors = ["at least one round must be selected"];
    const f = stubFetch(() => [422, { valid: false, errors }]);
    const { result } = renderHook(() => useCardRun(CARD, ctxA, true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.error?.status).toBe(422));
    expect(result.current.error?.errors[0]).toBe("at least one round must be selected");
    expect(result.current.status).toBeNull();
    await tick(5000);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("disabled when ctx is null", async () => {
    const f = stubFetch(runServer(["r1"], { r1: [[200, DONE]] }));
    const { result, rerender } = renderHook(
      ({ ctx, enabled }) => useCardRun(CARD, ctx, enabled),
      { wrapper: wrapper(), initialProps: { ctx: null as StateContext | null, enabled: true } },
    );
    await tick(3000);
    rerender({ ctx: ctxA, enabled: false });
    await tick(3000);
    expect(f).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ status: null, current: null, previous: null, isStale: false, error: null });
  });

  it("equal-by-value ctx does not restart the run", async () => {
    const f = stubFetch(runServer(["r1"], { r1: [[200, DONE]] }));
    const { result, rerender } = renderHook(({ ctx }) => useCardRun(CARD, ctx, true), {
      wrapper: wrapper(), initialProps: { ctx: ctxA },
    });
    await waitFor(() => expect(result.current.status?.state).toBe("done"));
    rerender({ ctx: { ...ctxA, rounds: [...ctxA.rounds] } });
    await tick(3000);
    expect(count(f, "POST", "/cards/run")).toBe(1);
    expect(result.current.current).toEqual(DONE.result);
  });

  it("refresh restarts the run for the same context", async () => {
    const f = stubFetch(runServer(["r1", "r2"], { r1: [[200, DONE]], r2: [[200, PARTIAL]] }));
    const { result } = renderHook(() => useCardRun(CARD, ctxA, true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status?.state).toBe("done"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status?.state).toBe("partial"));
    expect(count(f, "POST", "/cards/run")).toBe(2);
    expect(f.mock.calls.filter(([, i]) => i?.method === "POST").map(([, i]) => JSON.parse(String(i?.body)).context))
      .toEqual([ctxA, ctxA]);
  });

  it("a slow poll of an older context is never shown as current", async () => {
    let finishA: (r: [number, unknown]) => void = () => {};
    const slowA = new Promise<[number, unknown]>((resolve) => { finishA = resolve; });
    stubFetch(runServer(["rA", "rB"], { rA: [[200, RUNNING], slowA], rB: [[200, RUNNING]] }));
    const { result, rerender } = renderHook(({ ctx }) => useCardRun(CARD, ctx, true), {
      wrapper: wrapper(), initialProps: { ctx: ctxA },
    });
    await waitFor(() => expect(result.current.status?.state).toBe("running"));
    await tick(1500); // second GET /runs/rA is now in flight
    rerender({ ctx: ctxB });
    await waitFor(() => expect(result.current.status?.state).toBe("running"));
    await act(async () => finishA([200, DONE]));
    await tick(1500);
    expect(result.current.current).toBeNull();
    expect(result.current.previous).toBeNull();
    expect(result.current.status?.state).toBe("running");
  });

  it("a slow start of an older context is ignored", async () => {
    let startA: (r: [number, unknown]) => void = () => {};
    const slowStart = new Promise<[number, unknown]>((resolve) => { startA = resolve; });
    const f = stubFetch((path, method, body) => {
      if (method === "POST") {
        const ctx = (body as { context: StateContext }).context;
        return ctx.rounds.length === 2 ? slowStart : [200, { run_id: "rB" }];
      }
      return path === "/runs/rB" ? [200, RUNNING] : [200, DONE];
    });
    const { result, rerender } = renderHook(({ ctx }) => useCardRun(CARD, ctx, true), {
      wrapper: wrapper(), initialProps: { ctx: ctxA },
    });
    await tick(10);
    rerender({ ctx: ctxB });
    await waitFor(() => expect(result.current.status?.state).toBe("running"));
    await act(async () => startA([200, { run_id: "rA" }]));
    await tick(3000);
    expect(count(f, "GET", "/runs/rA")).toBe(0);
    expect(result.current.current).toBeNull();
  });
});

describe("poll retries", () => {
  it("one 502 on a poll is retried and the run recovers", async () => {
    const f = stubFetch(runServer(["r1"], { r1: [[502, { detail: "bad gateway" }], [200, DONE]] }));
    const { result } = renderHook(() => useCardRun(CARD, ctxA, true), { wrapper: wrapper() });
    await waitFor(() => expect(count(f, "GET", "/runs/")).toBe(1));
    expect(result.current.error).toBeNull();
    await tick(1000);
    await waitFor(() => expect(result.current.status?.state).toBe("done"));
    expect(result.current.error).toBeNull();
    expect(count(f, "GET", "/runs/")).toBe(2);
  });
});

describe("app query client defaults", () => {
  const appWrapper = () => {
    const client = createQueryClient();
    return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

  it("a 422 on the plan is requested exactly once", async () => {
    const f = stubFetch(() => [422, { detail: "bad context" }]);
    const { result } = renderHook(() => useCardPlan(CARD, ctxA), { wrapper: appWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    await tick(15000);
    expect(count(f, "POST", "/cards/plan")).toBe(1);
  });

  it("the plan is not refetched on focus", async () => {
    const f = stubFetch(() => [200, { rounds: [], unavailable: [], coverage_mode: {} }]);
    const { result } = renderHook(() => useCardPlan(CARD, ctxA), { wrapper: appWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await tick(1000);
    expect(count(f, "POST", "/cards/plan")).toBe(1);
  });
});

describe("catalogue hooks", () => {
  it("fetch states and templates by section", async () => {
    const f = stubFetch((path) => (path === "/catalogue/states" ? [200, states] : [200, templates]));
    const s = renderHook(() => useStates(), { wrapper: wrapper() });
    const t = renderHook(() => useTemplates("pulse"), { wrapper: wrapper() });
    await waitFor(() => expect(s.result.current.data).toEqual(["Uttar Pradesh"]));
    await waitFor(() => expect(t.result.current.data).toEqual(templates));
    expect(f.mock.calls.map(([u]) => String(u)).sort()).toEqual(["/api/catalogue/states", "/api/templates?section=pulse"]);
  });
});
