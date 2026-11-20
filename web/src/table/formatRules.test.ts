import { describe, expect, it } from "vitest";
import type { Cell } from "../api/types";
import type { CellGrid } from "./grid";
import { cellStyle, legend, tint } from "./formatRules";

const c = (value: number | null, delta: number | null): Cell => ({ value, delta, trend: [], secondary: null, flags: [], base: null });
const grid = (vals: [number | null, number | null][]): CellGrid => ({
  rows: vals.map((_, i) => ({ key: `r${i}`, label: `r${i}`, colour: null })),
  columns: [{ key: "a", label: "A", colour: null }],
  cells: Object.fromEntries(vals.map(([v, d], i) => [`r${i}`, { a: { cell: c(v, d), unit: "pct" as const } }])),
  rowDim: "r", columnDim: "c",
});
const alpha = (s: { background?: string }): number => Number(/,\s*([\d.]+)\)$/.exec(s.background ?? "")![1]);

describe("formatRules", () => {
  it("diverging scale is symmetric, with loss below zero and gain above", () => {
    const g = grid([[1, -2], [1, 4]]);
    const neg = cellStyle(g, "r0", "a", { kind: "diverging", within: "column" });
    const pos = cellStyle(g, "r1", "a", { kind: "diverging", within: "column" });
    expect(neg.background).toMatch(/^rgba\(180,\s*45,\s*45/); // loss
    expect(pos.background).toMatch(/^rgba\(10,\s*108,\s*65/); // gain
    // strength is |value| over the largest |value|: 0.5 for -2 and 1 for +4
    expect(alpha(neg)).toBeCloseTo(0.04 + 0.12 * 0.5);
    expect(alpha(pos)).toBeCloseTo(0.04 + 0.12 * 1);
  });

  it("tint is a soft wash: alpha runs from 0.04 to 0.16 and never beyond", () => {
    expect(alpha({ background: tint("gain", 1) })).toBeCloseTo(0.16);
    expect(alpha({ background: tint("loss", 0) })).toBeCloseTo(0.04);
    expect(alpha({ background: tint("primary", 5) })).toBeCloseTo(0.16);
    expect(alpha({ background: tint("primary", -3) })).toBeCloseTo(0.04);
  });

  it("heat never exceeds the soft ceiling at any strength", () => {
    const g = grid([[0, null], [50, null], [100, null]]);
    for (const key of ["r0", "r1", "r2"]) {
      const a = alpha(cellStyle(g, key, "a", { kind: "heat", within: "column" }));
      expect(a).toBeGreaterThanOrEqual(0.04);
      expect(a).toBeLessThanOrEqual(0.16);
    }
  });

  it("heat ignores nulls", () => {
    const g = grid([[null, null], [10, null], [20, null]]);
    const rule = { kind: "heat", within: "column" } as const;
    expect(cellStyle(g, "r0", "a", rule)).toEqual({});
    expect(alpha(cellStyle(g, "r2", "a", rule))).toBeGreaterThan(alpha(cellStyle(g, "r1", "a", rule)));
    expect(legend(g, rule)).toEqual({ label: "Heat on value (scaled within each column)", range: null });
  });

  it("legend states its scope and gives a range only for the whole table", () => {
    const g = grid([[10, -3], [20, 4]]);
    expect(legend(g, { kind: "heat", within: "row" })).toEqual({ label: "Heat on value (scaled within each row)", range: null });
    expect(legend(g, { kind: "heat", within: "table" })).toEqual({ label: "Heat on value", range: "10% to 20%" });
    expect(legend(g, { kind: "diverging", within: "column" })).toEqual({ label: "Diverging on Δ (scaled within each column)", range: null });
    expect(legend(g, { kind: "diverging", within: "table" })).toEqual({ label: "Diverging on Δ", range: "▼4% to ▲4%" });
  });

  it("none and null delta are unstyled", () => {
    const g = grid([[1, null]]);
    expect(cellStyle(g, "r0", "a", { kind: "none" })).toEqual({});
    expect(cellStyle(g, "r0", "a", { kind: "diverging", within: "table" })).toEqual({});
    expect(legend(g, { kind: "none" })).toBeNull();
    expect(legend(g, { kind: "diverging", within: "table" })).toBeNull();
  });

  it("row scope uses only that row", () => {
    const g = grid([[10, null], [20, null]]);
    const s = cellStyle(g, "r0", "a", { kind: "heat", within: "row" });
    expect(s.background).toBeDefined(); // single value in scope still styled
  });
});
