import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, apiPost, fetchOptions, getRun, planCard, startRun, startValues, validateCard } from "./client";
import type { StateContext } from "./types";

const ctx: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["o1"], compare_round: null,
  anchor_round: null, version_mode: "extrapolated", geo_scope: "state",
};

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("422 becomes ApiError with errors", async () => {
    const errors = ["at least one round must be selected"];
    vi.stubGlobal("fetch", reply(422, { valid: false, errors }));
    const err = await planCard({ card_id: "c" }, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).errors).toEqual(errors);
    expect((err as ApiError).message).toBe(errors[0]);
  });

  it("404 detail becomes message", async () => {
    vi.stubGlobal("fetch", reply(404, { detail: "unknown run 'x'" }));
    const err = (await getRun("x").catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(404);
    expect(err.errors).toEqual(["unknown run 'x'"]);
  });

  it("non-JSON error falls back to HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    const err = (await apiGet("/x").catch((e: unknown) => e)) as ApiError;
    expect(err.message).toBe("HTTP 500");
    expect(err.errors).toEqual([]);
  });

  it("network failure becomes ApiError status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fail")));
    const err = (await apiGet("/x").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toBe("Cannot reach the dashboard API");
  });

  it("sends principal header", async () => {
    const f = reply(200, { run_id: "r1" });
    vi.stubGlobal("fetch", f);
    expect(await startRun({ card_id: "c" }, ctx)).toBe("r1");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/cards/run");
    expect(new Headers(init.headers).get("X-Dashboard-User")).toBe("anonymous");
    expect(JSON.parse(init.body as string)).toEqual({ card_id: "c", context: ctx });
  });

  it("apiPost sends JSON content type", async () => {
    const f = reply(200, {});
    vi.stubGlobal("fetch", f);
    await apiPost("/y", { a: 1 });
    const [, init] = f.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("startRun sends the card when inline and card_id otherwise", async () => {
    const inline = { id: "mine.1", family: "distribution" as const, title: "Mine", scenarios: ["vs_voting_intention"] };
    const f = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ run_id: "r1" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await startRun({ card: inline }, ctx);
    await startRun({ card_id: "lib" }, ctx, { kind: "none" });
    const bodies = f.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies[0]).toEqual({ card: inline, context: ctx });
    expect("card_id" in bodies[0]).toBe(false);
    expect(bodies[1]).toEqual({ card_id: "lib", context: ctx, reference: { kind: "none" } });
  });

  it("validateCard, startValues and fetchOptions post the draft and the context", async () => {
    const draft = { id: "d", family: "opinion" as const, title: "T" };
    const f = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ run_id: "v1" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await validateCard(draft, ctx);
    expect(await startValues("caste", null, ctx, 2)).toBe("v1");
    await fetchOptions("scenarios", { kind: "party" }, draft, ctx);
    const calls = f.mock.calls.map(([url, init]) => [url, JSON.parse((init as RequestInit).body as string)]);
    expect(calls).toEqual([
      ["/api/cards/validate", { card: draft, context: ctx }],
      ["/api/configure/values", { field: "caste", scenario: null, context: ctx, pipe_rounds: 2 }],
      ["/api/configure/options", { source: "scenarios", params: { kind: "party" }, card: draft, context: ctx }],
    ]);
  });
});
