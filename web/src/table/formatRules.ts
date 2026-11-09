import { formatDelta, formatValue } from "../cells/format";
import type { CellGrid, GridCell } from "./grid";

type Within = "column" | "row" | "table";
export type FormatRule =
  | { kind: "none" }
  | { kind: "heat"; within: Within }
  | { kind: "diverging"; within: Within };

// Colour-blind safe blue / orange (ColorBrewer RdBu-style endpoints).
const BLUE = "33, 102, 172";
const ORANGE = "230, 97, 1";
const MAX_ALPHA = 0.6;

const partOf = (rule: FormatRule): "value" | "delta" => (rule.kind === "heat" ? "value" : "delta");

function scoped(g: CellGrid, rowKey: string, colKey: string, within: Within): GridCell[] {
  const rows = within === "column" || within === "table" ? g.rows.map((r) => r.key) : [rowKey];
  const cols = within === "row" || within === "table" ? g.columns.map((c) => c.key) : [colKey];
  return rows.flatMap((r) => cols.map((c) => g.cells[r]?.[c])).filter((x): x is GridCell => x !== undefined);
}

const numbers = (cells: GridCell[], part: "value" | "delta"): number[] =>
  cells.flatMap((x) => x.cell?.[part] ?? []);

/** Display-only colour; never changes a value. */
export function cellStyle(g: CellGrid, rowKey: string, colKey: string, rule: FormatRule): { background?: string } {
  if (rule.kind === "none") return {};
  const part = partOf(rule);
  const v = g.cells[rowKey]?.[colKey]?.cell?.[part] ?? null;
  if (v === null) return {};
  const all = numbers(scoped(g, rowKey, colKey, rule.within), part);
  if (rule.kind === "heat") {
    const min = Math.min(...all), max = Math.max(...all);
    const t = max === min ? 0.5 : (v - min) / (max - min);
    return { background: `rgba(${BLUE}, ${(0.08 + (MAX_ALPHA - 0.08) * t).toFixed(3)})` };
  }
  const m = Math.max(...all.map(Math.abs));
  if (m === 0 || v === 0) return {};
  return { background: `rgba(${v > 0 ? BLUE : ORANGE}, ${((Math.abs(v) / m) * MAX_ALPHA).toFixed(3)})` };
}

/** Whole-table legend; each end is formatted with the unit of the cell that holds it. */
export function legend(g: CellGrid, rule: FormatRule): { label: string; min: string; max: string } | null {
  if (rule.kind === "none") return null;
  const part = partOf(rule);
  const found = g.rows.flatMap((r) =>
    g.columns.flatMap((c) => {
      const gc = g.cells[r.key]?.[c.key];
      const v = gc?.cell?.[part] ?? null;
      return gc && v !== null ? [{ v, unit: gc.unit }] : [];
    }),
  );
  if (found.length === 0) return null;
  const lo = found.reduce((a, b) => (b.v < a.v ? b : a));
  const hi = found.reduce((a, b) => (b.v > a.v ? b : a));
  if (rule.kind === "heat") {
    return { label: "Heat on value", min: formatValue(lo.v, lo.unit), max: formatValue(hi.v, hi.unit) };
  }
  const big = found.reduce((a, b) => (Math.abs(b.v) > Math.abs(a.v) ? b : a));
  return { label: "Diverging on Δ", min: formatDelta(-Math.abs(big.v), big.unit), max: formatDelta(Math.abs(big.v), big.unit) };
}
