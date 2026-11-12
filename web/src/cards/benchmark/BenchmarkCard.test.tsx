import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BenchmarkPayload, RunStatus, StateContext } from "../../api/types";
import { BENCHMARK, infoFor, stubCardApi } from "../../test/cardApi";
import { renderWithProviders } from "../../test/render";
import { BenchmarkCard } from "./BenchmarkCard";

const CTX: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["R1", "R2"], compare_round: "R1", anchor_round: "R2",
  version_mode: "extrapolated", geo_scope: "state",
};
const ELECTIONS = [{ year: 2022, election_type: "VS" as const, label: "2022 VS" }];

afterEach(() => vi.unstubAllGlobals());

const mount = (p: BenchmarkPayload) => {
  const f = stubCardApi({ payloads: [p], elections: ELECTIONS });
  renderWithProviders(<BenchmarkCard info={infoFor(p)} ctx={CTX} />);
  return f;
};
const runPosts = (f: ReturnType<typeof stubCardApi>) =>
  f.mock.calls.filter(([url, init]) => String(url).endsWith("/cards/run") && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)) as { reference?: unknown });
const withoutReference = (p: BenchmarkPayload): BenchmarkPayload => ({
  ...p, reference: { kind: "none", label: null }, comparisons: [], flips: [],
  summaries: p.summaries.filter((r) => r.endpoint === "target"),
  margin_buckets: p.margin_buckets.filter((r) => r.endpoint === "target"),
  tables_available: ["summary", "margin_buckets"], default_table: "summary",
});

describe("BenchmarkCard", () => {
  it("opens on the comparison table when there is a reference", async () => {
    mount(BENCHMARK.surveyVs2022());
    expect(await screen.findByRole("table", { name: /Comparison/ })).toBeInTheDocument();
  });

  it("opens on the card's own view table: a copy with a different view shows another tab of the same data", async () => {
    mount({ ...BENCHMARK.surveyVs2022(), default_table: "flips" });
    expect(await screen.findByRole("table", { name: /Flips/ })).toBeInTheDocument();
  });

  it("opens on the seat summary without a reference, and the chooser hides tables that cannot exist", async () => {
    mount(withoutReference(BENCHMARK.surveyVs2022()));
    expect(await screen.findByRole("table", { name: /Seat summary/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Table/ }));
    const chooser = await screen.findByLabelText("Table");
    expect(within(chooser).getAllByRole("option").map((o) => o.textContent)).toEqual(["Seat summary", "Margin buckets"]);
  });

  it("switching tables is display-only and never fetches", async () => {
    const f = mount(BENCHMARK.surveyVs2022());
    await screen.findByRole("table", { name: /Comparison/ });
    const calls = f.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /Table/ }));
    await userEvent.selectOptions(await screen.findByLabelText("Table"), "flips");
    expect(await screen.findByRole("table", { name: /Flips/ })).toBeInTheDocument();
    expect(f.mock.calls.length).toBe(calls);
  });

  it("the reference picker is the one control that starts exactly one new run", async () => {
    const f = mount(BENCHMARK.surveyVs2022());
    await screen.findByRole("table", { name: /Comparison/ });
    const before = runPosts(f).length;
    await userEvent.click(screen.getByRole("button", { name: /Reference/ }));
    const picker = await screen.findByLabelText("Reference");
    expect(within(picker).getAllByRole("option").map((o) => o.textContent))
      .toEqual(["No reference", "Compare round (R1)", "2022 VS"]);
    await userEvent.selectOptions(picker, "election:2022:VS");
    await waitFor(() => expect(runPosts(f).length).toBe(before + 1));
    const posts = runPosts(f);
    expect(posts[posts.length - 1].reference).toEqual({ kind: "election", year: 2022, election_type: "VS" });
  });

  it("copies the engine's values exactly", async () => {
    const p = BENCHMARK.surveyVs2022();
    mount(p);
    const table = await screen.findByRole("table", { name: /Comparison/ });
    const nda = p.comparisons.find((r) => r.group.set_id === "g0" && r.party === "NDA")!;
    const row = within(table).getAllByRole("row").find((r) => within(r).queryByRole("rowheader", { name: "NDA" }))!;
    const text = row.textContent ?? "";
    expect(text).toContain("154");
    expect(text).toContain("273");
    expect(text).toContain("-119");
    expect(text).toContain(`${nda.target_vote_share!.toFixed(1)}%`);
  });

  it("shows Other last and names it with the payload's label", async () => {
    mount(BENCHMARK.surveyVs2022());
    const table = await screen.findByRole("table", { name: /Comparison/ });
    const header = within(table).getAllByRole("rowheader").map((h) => h.textContent);
    expect(header.filter((t) => t === "Other").length).toBeGreaterThan(0);
  });

  it("shows a dash with the reason for a party missing from an endpoint, never a zero", async () => {
    const p = BENCHMARK.surveyVs2022();
    const g0 = p.comparisons.find((r) => r.group.set_id === "g0")!.group;
    p.parties = [...p.parties, "INDI"];
    p.comparisons.push({
      group: g0, party: "INDI", eligible_seats: 403, target_vote_share: null, reference_vote_share: 1.2,
      vote_share_delta_pp: null, target_seats: null, reference_seats: 2, seat_delta: null,
      seat_share_delta_pp: null, absent_sides: ["target"],
    });
    mount(p);
    const table = await screen.findByRole("table", { name: /Comparison/ });
    const row = within(table).getAllByRole("row").find((r) => within(r).queryByRole("rowheader", { name: "INDI" }))!;
    expect(within(row).getAllByTitle("not in this endpoint's mapping").length).toBeGreaterThan(0);
    expect(within(row).getAllByText("–").length).toBeGreaterThanOrEqual(4);
  });

  it("says so in words when no seat is covered", async () => {
    const p = BENCHMARK.surveyVs2022();
    mount({ ...p, comparisons: [], summaries: [], margin_buckets: [], flips: [] });
    expect(await screen.findByText(/No seats are covered by both endpoints/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("explains how Other is built in the footer", async () => {
    mount(BENCHMARK.surveyVs2022());
    await screen.findByRole("table", { name: /Comparison/ });
    expect(screen.getByTestId("card-footer")).toHaveTextContent(/Other: every party outside the major list, and NOTA/);
  });

  it("clears the old subtitle, chips and method text while a new run is in progress", async () => {
    const p = BENCHMARK.surveyVs2022();
    const runs: Record<string, RunStatus> = {};
    stubCardApi({ payloads: [p], elections: ELECTIONS, runs });
    renderWithProviders(<BenchmarkCard info={infoFor(p)} ctx={CTX} />);
    await screen.findByRole("table", { name: /Comparison/ });
    expect(screen.getByTestId("card-subtitle")).toBeInTheDocument();
    runs[p.card_id] = { state: "running", done: 0, total: 1, result: null, errors: {} };
    await userEvent.click(screen.getByRole("button", { name: /Reference/ }));
    await userEvent.selectOptions(await screen.findByLabelText("Reference"), "none");
    expect(await screen.findByText(/Running the benchmark/)).toBeInTheDocument();
    expect(screen.queryByTestId("card-subtitle")).toBeNull();
    expect(screen.queryByRole("button", { name: /Search/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "⋯" })).toBeNull();
  });

  it("falls back to the default reference when the chosen compare round is dropped", async () => {
    const p = BENCHMARK.surveyVs2022();
    const f = stubCardApi({ payloads: [p], elections: ELECTIONS });
    const Harness = () => {
      const [ctx, setCtx] = useState<StateContext>(CTX);
      return (
        <>
          <button onClick={() => setCtx({ ...CTX, compare_round: null })}>drop compare</button>
          <BenchmarkCard info={infoFor(p)} ctx={ctx} />
        </>
      );
    };
    renderWithProviders(<Harness />);
    await screen.findByRole("table", { name: /Comparison/ });
    await userEvent.click(screen.getByRole("button", { name: /Reference/ }));
    await userEvent.selectOptions(await screen.findByLabelText("Reference"), "election:2022:VS");
    await userEvent.selectOptions(await screen.findByLabelText("Reference"), "compare");
    await userEvent.click(screen.getByRole("button", { name: "drop compare" }));
    await waitFor(() => expect(runPosts(f).length).toBe(4)); // default, election, compare, then the fallback
    expect(runPosts(f)[3].reference ?? null).toBeNull(); // not {kind: "compare"} for a round that is gone
  });

  it("says so in words when a search matches nothing", async () => {
    mount(BENCHMARK.surveyVs2022());
    await screen.findByRole("table", { name: /Comparison/ });
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.type(await screen.findByLabelText("Search rows"), "zzzz");
    expect(await screen.findByText(/No rows match/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
