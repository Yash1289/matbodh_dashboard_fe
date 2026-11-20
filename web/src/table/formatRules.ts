import { formatDelta, formatValue } from "../cells/format";
import type { CellGrid, GridCell } from "./grid";

type Within = "column" | "row" | "table";
export type FormatRule =
  | { kind: "none" }
  | { kind: "heat"; within: Within }
  | { kind: "diverging"; within: Within };

// Soft washes: a gain or loss tone for diverging, the primary tone for heat. The change figures carry an
// arrow and a sign, so colour is never the only signal.
const TONES = { gain: "10, 108, 65", loss: "180, 45, 45", primary: "38, 99, 235" } as const;
const MIN_ALPHA = 0.04;
const MAX_ALPHA = 0.16;

/** A soft tint of a tone; strength 0 to 1 (clamped) runs the alpha from 0.04 to 0.16. */
export function tint(tone: keyof typeof TONES, strength: number): string {
  const t = Math.min(1, Math.max(0, strength));
  return `rgba(${TONES[tone]}, ${(MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * t).toFixed(3)})`;
}

// Diverging colours the Δ, except in standalone and trend cards, which have none: the value then.
const partOf = (rule: FormatRule, g: CellGrid): "value" | "delta" =>
  rule.kind === "heat" || g.mode === "standalone" || g.mode === "trend" ? "value" : "delta";

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
  const part = partOf(rule, g);
  const v = g.cells[rowKey]?.[colKey]?.cell?.[part] ?? null;
  if (v === null) return {};
  const all = numbers(scoped(g, rowKey, colKey, rule.within), part);
  if (rule.kind === "heat") {
    const min = Math.min(...all), max = Math.max(...all);
    const t = max === min ? 0.5 : (v - min) / (max - min);
    return { background: tint("primary", t) };
  }
  const m = Math.max(...all.map(Math.abs));
  if (m === 0 || v === 0) return {};
  return { background: tint(v > 0 ? "gain" : "loss", Math.abs(v) / m) };
}

const SCOPE_TEXT = { column: " (scaled within each column)", row: " (scaled within each row)", table: "" } as const;

/** Legend; a min-max range is only meaningful (and shown) when scaling is across the whole table. */
export function legend(g: CellGrid, rule: FormatRule): { label: string; range: string | null } | null {
  if (rule.kind === "none") return null;
  const part = partOf(rule, g);
  const found = g.rows.flatMap((r) =>
    g.columns.flatMap((c) => {
      const gc = g.cells[r.key]?.[c.key];
      const v = gc?.cell?.[part] ?? null;
      return gc && v !== null ? [{ v, unit: gc.unit }] : [];
    }),
  );
  if (found.length === 0) return null;
  const name = rule.kind === "heat" ? "Heat on value" : part === "delta" ? "Diverging on Δ" : "Diverging on value";
  const label = name + SCOPE_TEXT[rule.within];
  if (rule.within !== "table") return { label, range: null };
  if (rule.kind === "heat") {
    const lo = found.reduce((a, b) => (b.v < a.v ? b : a));
    const hi = found.reduce((a, b) => (b.v > a.v ? b : a));
    return { label, range: `${formatValue(lo.v, lo.unit)} to ${formatValue(hi.v, hi.unit)}` };
  }
  const big = found.reduce((a, b) => (Math.abs(b.v) > Math.abs(a.v) ? b : a));
  return { label, range: `${formatDelta(-Math.abs(big.v), big.unit)} to ${formatDelta(Math.abs(big.v), big.unit)}` };
}
