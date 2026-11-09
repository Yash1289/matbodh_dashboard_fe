import { describe, expect, it } from "vitest";
import type { Cell } from "../api/types";
import type { CellGrid } from "./grid";
import { cellStyle, legend } from "./formatRules";

const c = (value: number | null, delta: number | null): Cell => ({ value, delta, trend: [], secondary: null, flags: [], base: null });
const grid = (vals: [number | null, number | null][]): CellGrid => ({
  rows: vals.map((_, i) => ({ key: `r${i}`, label: `r${i}`, colour: null })),
  columns: [{ key: "a", label: "A", colour: null }],
  cells: Object.fromEntries(vals.map(([v, d], i) => [`r${i}`, { a: { cell: c(v, d), unit: "pct" as const } }])),
  rowDim: "r", columnDim: "c",
});
const alpha = (s: { background?: string }): number => Number(/,\s*([\d.]+)\)$/.exec(s.background ?? "")![1]);

describe("formatRules", () => {
  it("diverging scale is symmetric", () => {
    const g = grid([[1, -2], [1, 4]]);
    const neg = cellStyle(g, "r0", "a", { kind: "diverging", within: "column" });
    const pos = cellStyle(g, "r1", "a", { kind: "diverging", within: "column" });
    expect(neg.background).toMatch(/^rgba\(230,\s*97,\s*1/); // orange
    expect(pos.background).toMatch(/^rgba\(33,\s*102,\s*172/); // blue
    expect(alpha(neg) * 2).toBeCloseTo(alpha(pos));
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
