import { describe, expect, it } from "vitest";
import type { GridPayload } from "../../api/types";
import { formatValue } from "../../cells/format";
import compareFixture from "../../test/fixtures/cards/distribution_compare.json";
import standaloneFixture from "../../test/fixtures/cards/distribution_standalone.json";
import trendFixture from "../../test/fixtures/cards/distribution_trend.json";
import opinionFixture from "../../test/fixtures/cards/opinion_standalone.json";
import { payloadToGrid } from "./payloadToGrid";

const load = (fixture: unknown): GridPayload => structuredClone(fixture) as GridPayload;
const cellOf = (p: GridPayload, cutId: string, row: string, column: string, lens: string, round?: string) =>
  p.cuts.find((c) => c.id === cutId)!.cells.find(
    (c) => c.row === row && c.column === column && c.lens === lens && (round === undefined || c.round === round),
  );

describe("payloadToGrid: lenses and units", () => {
  it("switches value and unit with the lens", () => {
    const p = load(standaloneFixture);
    const cut = p.cuts[0].id;
    const support = payloadToGrid(p, { lens: "support_share", cut });
    const impact = payloadToGrid(p, { lens: "size_of_impact_pp", cut });
    const row = support.rows[0].key;
    const col = support.columns[0].key;
    expect(support.cells[row][col].unit).toBe("pct");
    expect(impact.cells[row][col].unit).toBe("pp");
    expect(support.cells[row][col].cell?.value).toBe(cellOf(p, cut, row, col, "support_share")!.value);
    expect(impact.cells[row][col].cell?.value).toBe(cellOf(p, cut, row, col, "size_of_impact_pp")?.value ?? null);
  });

  it("falls back to the default lens when the lens has no data", () => {
    const p = load(standaloneFixture);
    p.meta.lenses = p.meta.lenses.filter((l) => l.id !== "joint_share");
    const cut = p.cuts[0].id;
    const asked = payloadToGrid(p, { lens: "joint_share", cut });
    const dflt = payloadToGrid(p, { lens: p.meta.default_lens, cut });
    expect(asked.cells).toEqual(dflt.cells);
  });

  it("shows only the columns that apply to the lens", () => {
    const p = load(opinionFixture);
    const kind = new Map(p.columns.map((c) => [c.key, c.kind]));
    const cut = p.cuts[0].id;
    const scores = payloadToGrid(p, { lens: "net_score", cut });
    const options = payloadToGrid(p, { lens: "option_support_share", cut });
    expect(scores.columns.length).toBeGreaterThan(0);
    expect(scores.columns.every((c) => kind.get(c.key) === "scale")).toBe(true);
    expect(options.columns.length).toBeGreaterThan(0);
    expect(options.columns.every((c) => kind.get(c.key) === "option")).toBe(true);
  });

  it("throws a clear error for an unknown cut", () => {
    const p = load(standaloneFixture);
    expect(() => payloadToGrid(p, { lens: "support_share", cut: "nope" })).toThrow(/Unknown cut/);
  });
});

describe("payloadToGrid: standalone", () => {
  it("has a value and nothing else", () => {
    const p = load(standaloneFixture);
    const grid = payloadToGrid(p, { lens: "support_share", cut: p.cuts[0].id });
    expect(grid.mode).toBe("standalone");
    const cell = grid.cells[grid.rows[0].key][grid.columns[0].key].cell!;
    expect(cell.delta).toBeNull();
    expect(cell.trend).toEqual([]);
  });

  it("labels the overall row", () => {
    const p = load(standaloneFixture);
    const grid = payloadToGrid(p, { lens: "support_share", cut: p.cuts[0].id });
    expect(grid.rows[0]).toMatchObject({ key: "overall", label: "Overall" });
  });

  it("never turns a null into a zero", () => {
    const p = load(standaloneFixture);
    const cut = p.cuts[0];
    const target = cut.cells.find((c) => c.lens === "support_share")!;
    target.value = null;
    target.status = "null_value";
    const grid = payloadToGrid(p, { lens: "support_share", cut: cut.id });
    const cell = grid.cells[target.row][target.column].cell!;
    expect(cell.value).toBeNull();
    expect(cell.flags).toContain("null_value");
    expect(formatValue(cell.value, "pct")).toBe("—");
  });

  it("keeps a subtotal row and a genuine-null row apart", () => {
    const p = load(standaloneFixture);
    const cut = p.cuts[0];
    cut.rows.push({ key: "category=GEN|caste=~null", labels: { category: "GEN", caste: null }, subtotal: [] });
    cut.rows.push({ key: "category=GEN", labels: { category: "GEN" }, subtotal: ["caste"] });
    const grid = payloadToGrid(p, { lens: "support_share", cut: cut.id });
    const byKey = new Map(grid.rows.map((r) => [r.key, r.label]));
    expect(byKey.get("category=GEN|caste=~null")).toBe("GEN · (no value)");
    expect(byKey.get("category=GEN")).toBe("GEN");
  });

  it("gives a population-only row null cells", () => {
    const p = load(standaloneFixture);
    const cut = p.cuts[0];
    cut.rows.push({ key: "category=ST", labels: { category: "ST" }, subtotal: [] });
    const grid = payloadToGrid(p, { lens: "support_share", cut: cut.id });
    for (const column of grid.columns) expect(grid.cells["category=ST"][column.key].cell).toBeNull();
  });
});

describe("payloadToGrid: compare", () => {
  const withDelta = (p: GridPayload) => {
    for (const cut of p.cuts) {
      const delta = cut.deltas.find((d) => d.lens === "support_share" && d.value !== null);
      if (delta) return { cut, delta };
    }
    throw new Error("fixture has no usable delta");
  };

  it("carries the engine delta and the reference label", () => {
    const p = load(compareFixture);
    const { cut, delta } = withDelta(p);
    const grid = payloadToGrid(p, { lens: "support_share", cut: cut.id });
    expect(grid.mode).toBe("compare");
    expect(grid.cells[delta.row][delta.column].cell?.delta).toBe(delta.value);
    expect(grid.referenceLabel).toBe(p.rounds.items.find((i) => i.label === "R1")?.base_name);
    expect(grid.referenceLabel).not.toBe("R1");
    expect(grid.cells[delta.row][delta.column].cell?.trend).toEqual([]);
  });

  it("keeps the value when the reference is missing and marks the delta", () => {
    const p = load(compareFixture);
    const { cut, delta } = withDelta(p);
    const valueBefore = cellOf(p, cut.id, delta.row, delta.column, "support_share")!.value;
    delta.value = null;
    delta.status = "missing_reference";
    const grid = payloadToGrid(p, { lens: "support_share", cut: cut.id });
    const cell = grid.cells[delta.row][delta.column].cell!;
    expect(cell.value).toBe(valueBefore);
    expect(cell.delta).toBeNull();
    expect(cell.flags).toContain("missing_reference");
  });
});

describe("payloadToGrid: trend", () => {
  it("carries one value per round, in round order", () => {
    const p = load(trendFixture);
    const cut = p.cuts[0];
    const grid = payloadToGrid(p, { lens: "support_share", cut: cut.id });
    expect(grid.mode).toBe("trend");
    expect(grid.roundLabels).toEqual(["R1", "R2"]);
    const row = grid.rows[0].key;
    const col = grid.columns[0].key;
    const cell = grid.cells[row][col].cell!;
    expect(cell.trend).toEqual([
      cellOf(p, cut.id, row, col, "support_share", "R1")?.value ?? null,
      cellOf(p, cut.id, row, col, "support_share", "R2")?.value ?? null,
    ]);
    expect(cell.value).toBe(cell.trend[1]);
    expect(cell.delta).toBeNull();
  });

  it("marks a round that did not ask the question as null with a not_asked flag", () => {
    const p = load(trendFixture);
    for (const cut of p.cuts) cut.cells = cut.cells.filter((c) => c.round !== "R1");
    p.not_asked = [{ part: "grid", rounds: ["2027 VS CAPI R1"] }];
    const cut = p.cuts[0];
    const grid = payloadToGrid(p, { lens: "support_share", cut: cut.id });
    const row = grid.rows[0].key;
    const col = grid.columns[0].key;
    const gridCell = grid.cells[row][col];
    expect(gridCell.cell!.trend[0]).toBeNull();
    expect(gridCell.cell!.trend[1]).not.toBeNull();
    expect(gridCell.roundFlags?.[0]).toContain("not_asked");
  });
});

describe("payloadToGrid: review fixes", () => {
  it("keeps the engine reason and the cell when the target round has no value", () => {
    const p = load(compareFixture);
    const cut = p.cuts[1];
    const delta = cut.deltas.find((d) => d.lens === "support_share")!;
    cut.cells = cut.cells.filter((c) => !(c.row === delta.row && c.column === delta.column && c.lens === "support_share"));
    delta.value = null;
    delta.status = "missing_target";
    const g = payloadToGrid(p, { lens: "support_share", cut: cut.id });
    const cell = g.cells[delta.row][delta.column].cell;
    expect(cell?.value).toBeNull();
    expect(cell?.flags).toContain("missing_target");
  });

  it("shows the unweighted sample size as the base, not a weight mass", () => {
    const p = load(compareFixture);
    const cut = p.cuts[1];
    const b = cut.bases.find((x) => x.round === "R2" && typeof x.fields.unweighted_base === "number")!;
    b.fields.weighted_denominator = 0.2549;
    b.fields.unweighted_base = 85;
    const cell = payloadToGrid(p, { lens: "support_share", cut: cut.id }).cells[b.row][b.column].cell;
    expect(cell?.base).toBe(85);
  });

  it("names the reference from the deltas, whatever the context compare round is", () => {
    const p = load(compareFixture);
    for (const cut of p.cuts) for (const d of cut.deltas) d.reference = "R2:ls_past";
    expect(payloadToGrid(p, { lens: "support_share", cut: p.cuts[1].id }).referenceLabel).toBe("ls_past");
  });
});
