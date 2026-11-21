import { describe, expect, it } from "vitest";
import { payloadToGrid } from "../cards/grid/payloadToGrid";
import { PAYLOADS } from "../test/cardApi";
import { applyPresentationRules, sortRows, transpose, type CellGrid, type PresentationRules } from "./grid";

const gridOf = (): CellGrid => {
  const p = PAYLOADS.distributionCompare();
  return payloadToGrid(p, { lens: p.meta.default_lens, cut: p.cuts[0].id });
};

describe("transpose and sort", () => {
  it("transpose twice is identity", () => {
    const g = gridOf();
    expect(transpose(transpose(g))).toEqual(g);
    const [r, c] = [g.rows[0].key, g.columns[0].key];
    expect(transpose(g).cells[c][r]).toEqual(g.cells[r][c]);
  });

  it("transpose keeps the mode and the round labels", () => {
    const g = { ...gridOf(), mode: "trend" as const, roundLabels: ["R1", "R2"] };
    expect(transpose(g)).toMatchObject({ mode: "trend", roundLabels: ["R1", "R2"] });
  });

  it("sort by delta desc puts nulls last and null restores API order", () => {
    const g = gridOf();
    const column = g.columns[0].key;
    const api = g.rows.map((r) => r.key);
    const delta = (k: string) => g.cells[k][column].cell?.delta ?? null;
    const known = api.filter((k) => delta(k) !== null);
    const sorted = sortRows(g, { column, part: "delta", dir: "desc" }, api).rows.map((r) => r.key);
    expect(sorted.slice(0, known.length).map(delta)).toEqual(known.map(delta).sort((a, b) => b! - a!));
    expect(sorted.slice(known.length).every((k) => delta(k) === null)).toBe(true);
    expect(sortRows(g, null, api).rows.map((r) => r.key)).toEqual(api);
  });
});

describe("applyPresentationRules", () => {
  it("orders columns by presentation rules, preserves unlisted items in the middle, and pins designated items to the end", () => {
    const grid: CellGrid = {
      rows: [{ key: "GEN", label: "GEN", colour: null }],
      columns: [
        { key: "Other", label: "Other", colour: null },
        { key: "BSP", label: "BSP", colour: null },
        { key: "SP+", label: "SP+", colour: null },
        { key: "NDA", label: "NDA", colour: null },
        { key: "NOTA", label: "NOTA", colour: null },
        { key: "IND", label: "IND", colour: null }, // unlisted party
      ],
      cells: {
        GEN: {
          Other: { cell: { value: 5, delta: null, trend: [], secondary: null, flags: [], base: null }, unit: "pct" },
          BSP: { cell: null, unit: "pct" },
          "SP+": { cell: null, unit: "pct" },
          NDA: { cell: null, unit: "pct" },
          NOTA: { cell: null, unit: "pct" },
          IND: { cell: null, unit: "pct" },
        }
      },
      rowDim: "category",
      columnDim: "party"
    };

    const rules: PresentationRules = {
      columnOrder: ["NDA", "SP+", "BSP", "ABSENT_PARTY"],
      pinLast: ["Other", "NOTA", "ABSENT_PIN"],
      entityColors: { "NDA": "#ff9933", "SP+": "#e11d48", "BSP": "#1e40af" }
    };

    const reordered = applyPresentationRules(grid, rules);
    // Order should be: specified order ("NDA", "SP+", "BSP") -> unlisted ("IND") -> pinned ("Other", "NOTA")
    expect(reordered.columns.map(c => c.key)).toEqual(["NDA", "SP+", "BSP", "IND", "Other", "NOTA"]);
    // Entity colors applied
    expect(reordered.columns[0].colour).toBe("#ff9933");
    expect(reordered.columns[1].colour).toBe("#e11d48");
    expect(reordered.columns[2].colour).toBe("#1e40af");
    expect(reordered.columns[3].colour).toBeNull();
    // Cells untouched
    expect(reordered.cells.GEN.Other.cell?.value).toBe(5);
  });

  it("orders rows when rowOrder is provided, preserving unlisted rows", () => {
    const grid: CellGrid = {
      rows: [
        { key: "ST", label: "ST", colour: null },
        { key: "GEN", label: "GEN", colour: null },
        { key: "SC", label: "SC", colour: null },
        { key: "OBC", label: "OBC", colour: null },
        { key: "Muslim", label: "Muslim", colour: null },
      ],
      columns: [{ key: "NDA", label: "NDA", colour: null }],
      cells: {
        ST: { NDA: { cell: null, unit: "pct" } },
        GEN: { NDA: { cell: null, unit: "pct" } },
        SC: { NDA: { cell: null, unit: "pct" } },
        OBC: { NDA: { cell: null, unit: "pct" } },
        Muslim: { NDA: { cell: null, unit: "pct" } },
      },
      rowDim: "category",
      columnDim: "party"
    };

    const rules: PresentationRules = {
      rowOrder: ["GEN", "OBC", "SC", "ST"]
    };

    const reordered = applyPresentationRules(grid, rules);
    // GEN, OBC, SC, ST in specified order, Muslim as unlisted at the end
    expect(reordered.rows.map(r => r.key)).toEqual(["GEN", "OBC", "SC", "ST", "Muslim"]);
  });

  it("resolves dictionary-shaped rowOrder by grid.rowDim", () => {
    const grid: CellGrid = {
      rows: [
        { key: "ST", label: "ST", colour: null },
        { key: "GEN", label: "GEN", colour: null },
        { key: "SC", label: "SC", colour: null },
        { key: "OBC", label: "OBC", colour: null },
      ],
      columns: [{ key: "NDA", label: "NDA", colour: null }],
      cells: {
        ST: { NDA: { cell: null, unit: "pct" } },
        GEN: { NDA: { cell: null, unit: "pct" } },
        SC: { NDA: { cell: null, unit: "pct" } },
        OBC: { NDA: { cell: null, unit: "pct" } },
      },
      rowDim: "category",
      columnDim: "party",
    };

    const rules: PresentationRules = {
      rowOrder: {
        category: ["GEN", "OBC", "SC", "ST"],
        zone: ["North", "South", "East", "West"],
      },
    };

    const reordered = applyPresentationRules(grid, rules);
    expect(reordered.rows.map(r => r.key)).toEqual(["GEN", "OBC", "SC", "ST"]);
  });

  it("handles null/undefined rules gracefully and returns unchanged grid", () => {
    const grid: CellGrid = {
      rows: [{ key: "GEN", label: "GEN", colour: null }],
      columns: [{ key: "NDA", label: "NDA", colour: null }],
      cells: { GEN: { NDA: { cell: null, unit: "pct" } } },
      rowDim: "category",
      columnDim: "party"
    };
    expect(applyPresentationRules(grid, null)).toBe(grid);
    expect(applyPresentationRules(grid, undefined)).toBe(grid);
  });

  it("handles empty rules object gracefully", () => {
    const grid: CellGrid = {
      rows: [{ key: "GEN", label: "GEN", colour: null }],
      columns: [
        { key: "BSP", label: "BSP", colour: "#0000ff" },
        { key: "NDA", label: "NDA", colour: null }
      ],
      cells: {
        GEN: {
          BSP: { cell: null, unit: "pct" },
          NDA: { cell: null, unit: "pct" }
        }
      },
      rowDim: "category",
      columnDim: "party"
    };
    const reordered = applyPresentationRules(grid, {});
    expect(reordered.columns.map(c => c.key)).toEqual(["BSP", "NDA"]);
    expect(reordered.columns[0].colour).toBe("#0000ff");
    expect(reordered.rows.map(r => r.key)).toEqual(["GEN"]);
  });
});

describe("applyPresentationRules with the same party under two questions", () => {
  it("keeps every column and puts both under the party's place in the order", () => {
    const h = (key: string): { key: string; label: string; colour: null } => ({ key, label: key, colour: null });
    const grid = { rows: [], columns: [h("q1:SP"), h("q1:NDA"), h("q2:SP"), h("q2:NDA")], cells: {}, rowDim: "", columnDim: "" };
    const name = (c: { key: string }) => c.key.slice(c.key.lastIndexOf(":") + 1);
    const out = applyPresentationRules(grid, { columnOrder: ["NDA", "SP"], entityColors: {} }, name);
    expect(out.columns.map((c) => c.key)).toEqual(["q1:NDA", "q2:NDA", "q1:SP", "q2:SP"]);
  });
});
