import { describe, expect, it } from "vitest";
import type { BenchmarkGroup, BenchmarkSummaryRow } from "../../api/types";
import { BENCHMARK } from "../../test/cardApi";
import { groupLabel, groupedRows, initialBenchmarkView, summaryMatrix } from "./benchmarkRows";

const group = (set_id: string, dims: Record<string, string> = {}): BenchmarkGroup => ({ set_id, dimensions: dims });
const row = (g: BenchmarkGroup, party: string, endpoint: "target" | "reference" = "target") =>
  ({ group: g, party, endpoint }) as Pick<BenchmarkSummaryRow, "group" | "party" | "endpoint">;

describe("benchmarkRows", () => {
  it("puts Other last in every group", () => {
    const p = BENCHMARK.surveyVs2022();
    const groups = groupedRows(p.comparisons, p.parties, p.other_label, "");
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) expect(g.rows[g.rows.length - 1].party).toBe("Other");
  });

  it("orders groups naturally: set first, then AC 1, 2, 10", () => {
    const rows = [row(group("g1", { ac_num: "10" }), "NDA"), row(group("g1", { ac_num: "2" }), "NDA"),
      row(group("g0"), "NDA"), row(group("g1", { ac_num: "1" }), "NDA")];
    expect(groupedRows(rows, ["NDA"], "Other", "").map((g) => g.label))
      .toEqual(["All seats", "ac_num: 1", "ac_num: 2", "ac_num: 10"]);
  });

  it("keeps the target endpoint before the reference inside a group, then party order", () => {
    const g = group("g0");
    const rows = [row(g, "Other", "reference"), row(g, "SP+", "target"), row(g, "NDA", "reference"), row(g, "NDA", "target")];
    expect(groupedRows(rows, ["NDA", "SP+"], "Other", "")[0].rows.map((r) => `${r.endpoint}:${r.party}`))
      .toEqual(["target:NDA", "target:SP+", "reference:NDA", "reference:Other"]);
  });

  it("search keeps rows whose group label or party matches", () => {
    const p = BENCHMARK.surveyVs2022();
    const zone = groupedRows(p.comparisons, p.parties, p.other_label, "big leader");
    expect(zone.length).toBe(1);
    expect(groupLabel(zone[0].rows[0].group)).toMatch(/Big Leader/);
    expect(groupedRows(p.comparisons, p.parties, p.other_label, "bsp").every((g) => g.rows.every((r) => r.party === "BSP"))).toBe(true);
  });

  it("opens on the card's preferred table when it exists, else the payload default", () => {
    const p = BENCHMARK.surveyVs2022();
    expect(initialBenchmarkView(p).table).toBe(p.default_table);
    expect(initialBenchmarkView({ ...p, tables_available: ["summary"], default_table: "summary" }).table).toBe("summary");
  });
});

describe("summaryMatrix", () => {
  it("has the parties as columns with Other last, and All seats as the first row", () => {
    const p = BENCHMARK.surveyVs2022();
    const m = summaryMatrix(p, "");
    expect(m.parties).toEqual([...p.parties, p.other_label]);
    expect(m.rows[0].label).toBe("All seats");
    expect(m.rows[0].eligible).toBe(403);
    expect(m.rows.length).toBeGreaterThan(1);
  });

  it("merges vote share and seats with their changes from the comparison row", () => {
    const p = BENCHMARK.surveyVs2022();
    const nda = p.comparisons.find((r) => r.group.set_id === "g0" && r.party === "NDA")!;
    const cell = summaryMatrix(p, "").rows[0].cells.NDA!;
    expect(cell).toEqual({
      voteShare: nda.target_vote_share, voteDelta: nda.vote_share_delta_pp,
      seats: nda.target_seats, seatDelta: nda.seat_delta, absent: false,
    });
    expect(cell.seats).toBe(154);
    expect(cell.seatDelta).toBe(-119);
  });

  it("leaves a cell empty, never zero, for a party a group has no row for", () => {
    const p = BENCHMARK.surveyVs2022();
    p.comparisons = p.comparisons.filter((r) => !(r.group.set_id === "g0" && r.party === "BSP"));
    expect(summaryMatrix(p, "").rows[0].cells.BSP).toBeNull();
  });

  it("falls back to the target summary rows, with no changes, when there is no reference", () => {
    const p = { ...BENCHMARK.surveyVs2022(), comparisons: [] };
    const nda = p.summaries.find((r) => r.endpoint === "target" && r.group.set_id === "g0" && r.party === "NDA")!;
    const cell = summaryMatrix(p, "").rows[0].cells.NDA!;
    expect(cell).toEqual({ voteShare: nda.vote_share, voteDelta: null, seats: nda.seats, seatDelta: null, absent: nda.absent !== null });
  });
});
