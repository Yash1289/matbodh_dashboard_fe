import { describe, expect, it } from "vitest";
import { payloadToGrid } from "../cards/grid/payloadToGrid";
import { PAYLOADS } from "../test/cardApi";
import { toCsv } from "./csv";
import type { CellGrid } from "./grid";

const gridOf = (make: () => ReturnType<typeof PAYLOADS.distributionStandalone>): CellGrid => {
  const p = make();
  return payloadToGrid(p, { lens: p.meta.default_lens, cut: p.cuts[0].id });
};

describe("csv", () => {
  it("a standalone column is its value, base and flags", () => {
    const g = gridOf(PAYLOADS.distributionStandalone);
    const key = g.columns[0].key;
    expect(toCsv(g).split("\r\n")[0].split(",").slice(0, 4)).toEqual(["row", key, `base_${key}`, `flags_${key}`]);
  });

  it("a compare column adds the engine delta", () => {
    const g = gridOf(PAYLOADS.distributionCompare);
    const key = g.columns[0].key;
    const header = toCsv(g).split("\r\n")[0].split(",");
    expect(header.slice(1, 3)).toEqual([key, `delta_${key}`]);
    const cell = g.cells[g.rows[0].key][key].cell!;
    const line = toCsv(g).split("\r\n")[1].split(",");
    expect(line[1]).toBe(cell.value === null ? "" : String(cell.value));
    expect(line[2]).toBe(cell.delta === null ? "" : String(cell.delta));
  });

  it("a trend column has one value per round and no delta", () => {
    const g = gridOf(PAYLOADS.distributionTrend);
    const key = g.columns[0].key;
    const header = toCsv(g).split("\r\n")[0].split(",");
    expect(header.slice(1, 3)).toEqual([`${key}_R1`, `${key}_R2`]);
    expect(header.some((h) => h.startsWith("delta_"))).toBe(false);
  });

  it("writes null as empty, not 0", () => {
    const g = gridOf(PAYLOADS.distributionStandalone);
    g.cells[g.rows[0].key][g.columns[0].key] = { cell: null, unit: "pct" };
    expect(toCsv(g).split("\r\n")[1].split(",").slice(1, 4)).toEqual(["", "", ""]);
  });

  it("keeps full precision and quotes per RFC 4180", () => {
    const g = gridOf(PAYLOADS.distributionStandalone);
    const key = g.columns[0].key;
    const row = g.rows[0].key;
    g.cells[row][key] = { cell: { ...g.cells[row][key].cell!, value: 42.0712345, flags: ["a", "b"], base: null }, unit: "pct" };
    g.rows[0].label = 'NDA, "x"';
    expect(toCsv(g).split("\r\n")[1].startsWith('"NDA, ""x""",42.0712345,,a;b')).toBe(true);
  });
});
