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
import zoneDoneJson from "../test/fixtures/run_by_zone_done.json";
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

type PlanReply = PlanResponse | Promise<PlanResponse>;

/** Plans answer `plan` (a list answers in order, last repeats); each POST /cards/run gets the next id; GET /runs/{id} answers `runs[id]`. */
function stubApi(plan: PlanReply | PlanReply[], runs: Record<string, RunStatus>) {
  const ids = Object.keys(runs);
  const plans = Array.isArray(plan) ? plan : [plan];
  let next = 0;
  let nextPlan = 0;
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api/, "");
    const method = init?.method ?? "GET";
    let json: unknown = { detail: "not found" };
    if (method === "POST" && path === "/cards/plan") json = await plans[Math.min(nextPlan++, plans.length - 1)];
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
    await user.click(screen.getByRole("button", { name: /^Cell:/ }));
    await user.click(await screen.findByRole("radio", { name: "Δ only" }));
    expect(screen.getByRole("radio", { name: "Δ only" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Cell: Δ only ▾" })).toBeInTheDocument();
    expect(f.mock.calls.length).toBe(calls);
  });

  it("density and format choices do not refetch", async () => {
    const user = userEvent.setup();
    const f = stubApi(PLAN, { r1: DONE });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    await screen.findByRole("table");
    const calls = f.mock.calls.length;
    await user.click(screen.getByRole("button", { name: /^Density:/ }));
    await user.click(await screen.findByRole("radio", { name: "Compact" }));
    expect(screen.getByRole("button", { name: "Density: Compact ▾" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Format ▾" }));
    await user.click(await screen.findByRole("radio", { name: "Heat on value" }));
    expect(screen.getByText(/Heat on value \(scaled within each column\)/)).toBeInTheDocument();
    expect(f.mock.calls.length).toBe(calls);
  });

  it("format choice survives a refresh", async () => {
    const user = userEvent.setup();
    stubApi(PLAN, { r1: DONE });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Format ▾" }));
    await user.click(await screen.findByRole("radio", { name: "Heat on value" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "⋯" }));
    await user.click(await screen.findByRole("menuitem", { name: "Refresh" }));
    await screen.findByRole("table");
    expect(screen.getByText(/Heat on value \(scaled within each column\)/)).toBeInTheDocument();
  });

  it("an active Δ sort keeps its chip when the Δ part is hidden", async () => {
    const user = userEvent.setup();
    stubApi(PLAN, { r1: DONE });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Sort ▾" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Sort by Δ" }), screen.getAllByRole("option", { name: /high to low/ })[0]);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /^Cell:/ }));
    await user.click(await screen.findByRole("radio", { name: "Share" }));
    expect(screen.getByRole("button", { name: "Sort ▾" })).toBeInTheDocument();
  });

  it("toolbar has the Frame A chips and no wireframe controls", async () => {
    stubApi(PLAN, { r1: DONE });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    await screen.findByRole("table");
    for (const name of ["Cell: Both + trend ▾", "Density: Standard ▾", "Format ▾", "⇄ Transpose", "Sort ▾", "⋯"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    for (const gone of ["Question", "Rows", "Columns", "+ Add state", "Focus party", "Sample values"]) {
      expect(document.body.textContent).not.toContain(gone);
    }
  });

  it("format chip shows scope and defaults to column", async () => {
    const user = userEvent.setup();
    stubApi(PLAN, { r1: DONE });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Format ▾" }));
    expect(await screen.findByRole("radio", { name: "None" })).toBeChecked();
    const scope = screen.getByRole("combobox", { name: "Format scope" });
    expect(scope).toHaveValue("column");
    expect(within(scope).getByRole("option", { name: "Within all columns" })).toBeInTheDocument();
  });

  it("zone card starts with diverging format", async () => {
    // The fixture has no deltas, and a legend needs at least one.
    const zone = structuredClone(asRun(zoneDoneJson));
    (zone.result as unknown as { grid: { rows: { series: { cell: { delta: number | null } }[] }[] } }).grid.rows[0].series[0].cell.delta = 1.2;
    stubApi(PLAN, { r1: zone });
    renderWithProviders(<Card template={BY_ZONE} ctx={ctxA} />);
    await screen.findByRole("table");
    expect(screen.getByText(/Diverging on Δ \(scaled within each column\)/)).toBeInTheDocument();
  });

  it("subtitle names anchor, compare and trend range", async () => {
    stubApi(PLAN, { r1: DONE });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} lead />);
    expect(await screen.findByText("Lead card · anchor round 2027 VS CAPI R2 · Δ vs 2027 VS CAPI R1 · trend R1 → R2")).toBeInTheDocument();
  });

  it("subtitle omits compare and trend for a single round", async () => {
    const single = structuredClone(DONE);
    single.result!.rounds.items = [single.result!.rounds.items[1]];
    single.result!.rounds.compare = null;
    stubApi(PLAN, { r1: single });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxB} />);
    expect(await screen.findByText("anchor round 2027 VS CAPI R2")).toBeInTheDocument();
  });

  it("footer has the method link that opens the drawer", async () => {
    const user = userEvent.setup();
    stubApi(PLAN, { r1: DONE });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    await user.click(await screen.findByRole("button", { name: "How this was calculated →" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
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
    expect(screen.getByTitle(/2027 VS CAPI R2 \(Extrapolated\)/)).toHaveTextContent("trend R1 → R2");
  });

  it("export csv downloads card file", async () => {
    const user = userEvent.setup();
    // Synthetic: NDA's anchor-round vote share with several decimals (display rounds it to 38%).
    const precise = structuredClone(DONE);
    const nda = precise.result!.scoreboard!.find((r) => r.series === "NDA")!.vote!;
    nda.value = 38.04321;
    nda.trend = [40.0, 38.04321];
    stubApi(PLAN, { r1: precise });
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
    const csv = await (createUrl.mock.calls[0][0] as Blob).text();
    expect(csv).toContain("38.04321");
    expect(csv).toContain("-1.5");
    expect(screen.getByText("NDA (BJP+)").closest("tr")!.textContent).toContain("38%");
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
    await user.click(screen.getByRole("button", { name: "⋯" }));
    expect(await screen.findByRole("menuitem", { name: "Export CSV" })).toBeDisabled();
  });

  it("previous result stays visible while the new plan is pending", async () => {
    const user = userEvent.setup();
    let resolvePlan: (p: PlanResponse) => void = () => {};
    const heldPlan = new Promise<PlanResponse>((resolve) => { resolvePlan = resolve; });
    stubApi([PLAN, heldPlan], { r1: DONE, r2: PARTIAL });
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
    expect(await screen.findByText("Checking what this card can show…")).toBeInTheDocument();
    expect(screen.getByText("Showing previous selection")).toBeInTheDocument();
    const dimmed = document.querySelector("[aria-busy='true']") as HTMLElement;
    expect(dimmed).toHaveStyle({ opacity: "0.5" });
    expect(within(dimmed).getByRole("table")).toBeInTheDocument();
    resolvePlan(PLAN);
    expect(await screen.findByText("Some parts failed: Seats PC")).toBeInTheDocument();
    expect(screen.queryByText("Showing previous selection")).not.toBeInTheDocument();
    expect(document.querySelector("[aria-busy='true']")).toBeNull();
  });

  describe("error for a new context never sits beside the previous context's metadata", () => {
    const FAILED: RunStatus = {
      ...PARTIAL, state: "failed", result: null,
      errors: { vote: { kind: "too_heavy", message: "Pick fewer rounds", fingerprint: null, jobs: ["vote"] } },
    };
    async function switchToBroken(breakOn: "plan" | "run" | "none", runs: Record<string, RunStatus>) {
      const user = userEvent.setup();
      const f = stubApi(PLAN, runs);
      const ok = f.getMockImplementation()!;
      let broken = false;
      f.mockImplementation(async (input, init) => {
        const path = String(input).replace(/^\/api/, "");
        const hit = broken && breakOn !== "none" && init?.method === "POST" && path === (breakOn === "plan" ? "/cards/plan" : "/cards/run");
        return hit ? new Response(JSON.stringify({ detail: "engine down" }), { status: breakOn === "plan" ? 422 : 500 }) : ok(input, init);
      });
      function Harness() {
        const [ctx, setCtx] = useState(ctxA);
        return (
          <>
            <button type="button" onClick={() => { broken = true; setCtx(ctxB); }}>switch</button>
            <Card template={SCOREBOARD} ctx={ctx} />
          </>
        );
      }
      renderWithProviders(<Harness />);
      await screen.findByRole("table");
      expect(screen.getByText(/trend R1 → R2/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "switch" }));
    }
    const expectBare = () => {
      expect(screen.queryByText(/trend R1 → R2/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "⋯" })).not.toBeInTheDocument();
    };

    it("plan error", async () => {
      await switchToBroken("plan", { r1: DONE });
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expectBare();
    });

    it("run start error", async () => {
      await switchToBroken("run", { r1: DONE });
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expectBare();
    });

    it("failed status", async () => {
      await switchToBroken("none", { r1: DONE, r2: FAILED });
      expect(await screen.findByText(/This cut is too heavy/)).toBeInTheDocument();
      expectBare();
    });
  });

  it("partly unavailable card runs and notes the missing part", async () => {
    const reason = "Gender gap needs the 'gender' field in every included round";
    const unavailable = [{ part: "gender_gap", reason }];
    const f = stubApi({ ...PLAN, unavailable }, { r1: { ...DONE, result: { ...DONE.result!, unavailable } } });
    renderWithProviders(<Card template={SCOREBOARD} ctx={ctxA} />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText(reason)).toBeInTheDocument();
    expect(within(table).getByText("Gender gap")).toBeInTheDocument();
    expect(screen.queryByText(/Some parts failed/)).not.toBeInTheDocument();
    expect(runStarts(f)).toBe(1);
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
    expect(text).toContain("pc boom");
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
