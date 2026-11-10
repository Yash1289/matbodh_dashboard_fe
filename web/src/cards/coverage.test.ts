import { describe, expect, it } from "vitest";
import { PAYLOADS } from "../test/cardApi";
import { payloadToGrid } from "./grid/payloadToGrid";
import { coverageNote, excludedNote, flagLegend, notAskedNote } from "./coverage";

describe("coverage notes", () => {
  it("coverageNote names each round's seats and version, marking a fallback", () => {
    const p = PAYLOADS.distributionCompare();
    Object.assign(p.rounds.items[0], { fallback: true, seats: 380, version: "normal" });
    Object.assign(p.rounds.items[1], { fallback: false, seats: 403, version: "extrapolated" });
    expect(coverageNote(p.rounds)).toBe(
      "2027 VS CAPI R1: 380 seats · Normal (no Extrapolated version) · 2027 VS CAPI R2: 403 seats · Extrapolated",
    );
  });

  it("excludedNote names rounds and does not repeat an exclusion reported twice", () => {
    const p = PAYLOADS.distributionCompare();
    p.coverage = [
      { job: "a", part: "grid", coverage: { excluded_by_observation: { R1: [5, 9], R2: [] } } },
      { job: "b", part: "grid", coverage: { excluded_by_observation: { R1: [5, 9], x9: [1] } } },
    ];
    expect(excludedNote(p)).toBe("2 seats excluded in 2027 VS CAPI R1 · 1 seats excluded in x9");
  });

  it("excludedNote tolerates string coverage and no exclusions", () => {
    const p = PAYLOADS.distributionStandalone();
    p.coverage = [{ job: "a", part: "grid", coverage: "independent" }];
    expect(excludedNote(p)).toBeNull();
  });

  it("notAskedNote lists the rounds in which the scenario was not asked", () => {
    const p = PAYLOADS.distributionTrend();
    expect(notAskedNote(p)).toBeNull();
    p.not_asked = [{ part: "grid", rounds: ["A", "B"] }];
    expect(notAskedNote(p)).toBe("Not asked in A, B");
  });

  it("flagLegend lists only the flags present, known ones first", () => {
    const p = PAYLOADS.distributionCompare();
    const g = payloadToGrid(p, { lens: p.meta.default_lens, cut: p.cuts[0].id });
    const [row, column] = [g.rows[0].key, g.columns[0].key];
    g.cells[row][column] = { cell: { value: 1, delta: null, trend: [], secondary: null, flags: ["unknown_flag", "no_delta"], base: null }, unit: "pct" };
    const reasons = flagLegend(g).map((f) => f.reason);
    expect(reasons.indexOf("No Δ available for this round pair")).toBeLessThan(reasons.indexOf("unknown_flag"));
    expect(reasons).not.toContain("not_asked");
  });
});
