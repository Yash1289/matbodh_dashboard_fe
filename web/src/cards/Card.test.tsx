import { render, screen, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanResponse, RunStatus, StateContext, Template } from "../api/types";
import planByZoneJson from "../test/fixtures/plan_by_zone_state_level.json";
import planScoreboardJson from "../test/fixtures/plan_scoreboard.json";
import runningJson from "../test/fixtures/run_running.json";
import doneJson from "../test/fixtures/run_scoreboard_done.json";
import partialJson from "../test/fixtures/run_scoreboard_partial.json";
import templatesJson from "../test/fixtures/templates_pulse.json";
import { renderWithProviders } from "../test/render";
import { Card } from "./Card";
import { MethodDrawer } from "./MethodDrawer";

const asRun = (v: unknown) => v as RunStatus;
const asPlan = (v: unknown) => v as PlanResponse;
const RUNNING = asRun(runningJson);
const DONE = asRun(doneJson);
const PARTIAL = asRun(partialJson);
const PLAN = asPlan(planScoreboardJson);
const TEMPLATES = templatesJson as Template[];
const SCOREBOARD = TEMPLATES.find((t) => t.id === "pulse.party_scoreboard")!;
const BY_ZONE = TEMPLATES.find((t) => t.id === "pulse.by_zone")!;

const ctxA: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["o1", "o2"], compare_round: "o1",
  anchor_round: "o2", version_mode: "extrapolated", geo_scope: "state",
};
const ctxB: StateContext = { ...ctxA, rounds: ["o2"], compare_round: null };

/** Plan answers `plan`; each POST /cards/run gets the next id; GET /runs/{id} answers `runs[id]`. */
function stubApi(plan: PlanResponse, runs: Record<string, RunStatus>) {
  const ids = Object.keys(runs);
  let next = 0;
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api/, "");
    const method = init?.method ?? "GET";
    let json: unknown = { detail: "not found" };
    if (method === "POST" && path === "/cards/plan") json = plan;
    else if (method === "POST" && path === "/cards/run") json = { run_id: ids[Math.min(next++, ids.length - 1)] };
    else if (path.startsWith("/runs/")) json = runs[path.slice("/runs/".length)];
    return new Response(JSON.stringify(json), { status: json === undefined ? 404 : 200 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const runStarts = (f: ReturnType<typeof stubApi>) =>
  f.mock.calls.filter(([u, i]) => i?.method === "POST" && String(u) === "/api/cards/run").length;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Card", () => {
  it("renders nothing without a context", () => {
    const f = stubApi(PLAN, { r1: DONE });
    renderWithProviders(<Card template={SCOREBOARD} ctx={null} />);
    expect(screen.queryByText(SCOREBOARD.title)).not.toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
  });

  it("card shows progress while running", async () => {
    stubApi(PLAN, { r1: RUNNING });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    expect(await screen.findByText(`${RUNNING.done} of ${RUNNING.total} runs done`)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("fully unavailable card is greyed and never runs", async () => {
    const plan = asPlan(planByZoneJson);
    const f = stubApi(plan, { r1: DONE });
    renderWithProviders(<Card template={BY_ZONE} ctx={{ ...ctxA, level: "state" }} />);
    const reason = await screen.findByText(plan.unavailable[0].reason, { exact: false });
    expect(reason.closest("[aria-disabled='true']")).not.toBeNull();
    expect(runStarts(f)).toBe(0);
  });

  it("partial card lists failed part", async () => {
    stubApi(PLAN, { r1: PARTIAL });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    expect(await screen.findByText("Some parts failed: Seats PC")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("infrastructure error message has no trace", async () => {
    const failed: RunStatus = {
      ...PARTIAL, state: "failed", result: null,
      errors: { vote: { kind: "infrastructure", message: "Traceback (most recent call last): boom", fingerprint: "abc123", jobs: ["vote"] } },
    };
    stubApi(PLAN, { r1: failed });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    expect(await screen.findByText("Temporary engine problem — try Refresh")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Traceback");
    expect(document.body.textContent).not.toContain("abc123");
  });

  it("other error kinds show their message", async () => {
    const failed: RunStatus = {
      ...PARTIAL, state: "failed", result: null,
      errors: {
        vote: { kind: "too_heavy", message: "Pick fewer rounds", fingerprint: null, jobs: ["vote"] },
        seats_ac: { kind: "config", message: "bad field", fingerprint: null, jobs: ["seats_ac"] },
      },
    };
    stubApi(PLAN, { r1: failed });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    expect(await screen.findByText(/This cut is too heavy/)).toHaveTextContent("Pick fewer rounds");
    expect(screen.getByText("bad field")).toBeInTheDocument();
  });

  it("transpose and preset do not refetch", async () => {
    const user = userEvent.setup();
    const f = stubApi(PLAN, { r1: DONE });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    const table = await screen.findByRole("table");
    const calls = f.mock.calls.length;
    expect(within(table).getAllByRole("columnheader")[0]).toHaveTextContent("series");
    await user.click(screen.getByRole("button", { name: "⇄ Transpose" }));
    expect(within(screen.getByRole("table")).getAllByRole("columnheader")[0]).toHaveTextContent("measure");
    await user.click(screen.getByRole("radio", { name: "Δ only" }));
    expect(screen.getByRole("radio", { name: "Δ only" })).toBeChecked();
    expect(f.mock.calls.length).toBe(calls);
  });

  it("format scope defaults to column", async () => {
    stubApi(PLAN, { r1: DONE });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    await screen.findByRole("table");
    const scope = screen.getByRole("combobox", { name: "Format scope" });
    expect(scope).toHaveValue("column");
    expect(within(scope).getByRole("option", { name: "Within all columns" })).toBeInTheDocument();
  });

  it("hidden values are announced", async () => {
    stubApi(PLAN, { r1: { ...DONE, result: { ...DONE.result!, hidden_count: 2 } } });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    expect(await screen.findByText("2 values hidden")).toBeInTheDocument();
  });

  it("footer shows method versions", async () => {
    stubApi(PLAN, { r1: DONE });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    expect(
      await screen.findByText("Method: rules 8df18ed3b831e1e0 · engine 0.8.0 · metadata r9 · alliances e0"),
    ).toBeInTheDocument();
    expect(screen.getByText(/2027 VS CAPI R1: 380 seats · Normal \(no Extrapolated version\)/)).toBeInTheDocument();
    expect(screen.getByTitle(/2027 VS CAPI R2 \(Extrapolated\)/)).toHaveTextContent("2 rounds");
  });

  it("export csv downloads card file", async () => {
    const user = userEvent.setup();
    stubApi(PLAN, { r1: DONE });
    const createUrl = vi.fn((_: Blob | MediaSource) => "blob:csv");
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = createUrl;
      static revokeObjectURL = vi.fn();
    });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "⋯" }));
    await user.click(await screen.findByRole("menuitem", { name: "Export CSV" }));
    expect(clicked).toEqual(["pulse.party_scoreboard.csv"]);
    expect(await (createUrl.mock.calls[0][0] as Blob).text()).toContain("-1.5");
  });

  it("previous result shown dimmed while new context runs", async () => {
    const user = userEvent.setup();
    stubApi(PLAN, { r1: DONE, r2: RUNNING });
    function Harness() {
      const [ctx, setCtx] = useState(ctxA);
      return (
        <>
          <button type="button" onClick={() => setCtx(ctxB)}>switch</button>
          <Card template={SCOREBOARD} ctx={ctx} />
        </>
      );
    }
    renderWithProviders(<Harness />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "switch" }));
    expect(await screen.findByText(`${RUNNING.done} of ${RUNNING.total} runs done`)).toBeInTheDocument();
    const label = screen.getByText("Showing previous selection");
    const dimmed = label.parentElement!.querySelector("[aria-busy='true']") as HTMLElement;
    expect(dimmed).toHaveStyle({ opacity: "0.5" });
    expect(within(dimmed).getByRole("table")).toBeInTheDocument();
  });
});

describe("MethodDrawer", () => {
  it("shows rounds, coverage modes, contract and error fingerprints", () => {
    render(
      <MantineProvider>
        <MethodDrawer result={PARTIAL.result} plan={PLAN} errors={PARTIAL.errors} />
      </MantineProvider>,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("2027 VS CAPI R2 (Extrapolated)");
    expect(text).toContain("seats_ac: independent");
    expect(text).toContain("common_positive_eligible_seats_full_constituents");
    expect(text).toContain("Seats PC: config");
    expect(text).toContain(PARTIAL.errors.seats_pc.fingerprint!);
  });

  it("works with no result", () => {
    render(
      <MantineProvider>
        <MethodDrawer result={null} plan={null} errors={{}} />
      </MantineProvider>,
    );
    expect(screen.getByText("No result yet")).toBeInTheDocument();
  });
});
