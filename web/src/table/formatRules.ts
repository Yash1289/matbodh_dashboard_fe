import type { CellGrid, GridCell } from "./grid";

type Within = "column" | "row" | "table";
export type FormatRule =
  | { kind: "none" }
  | { kind: "heat"; within: Within }
  | { kind: "diverging"; within: Within };

// Soft washes: a gain or loss tone for diverging, the gain green for heat (a single value is better or worse than the rest, not blue). The change figures carry an
// arrow and a sign, so colour is never the only signal.
const TONES = { gain: "10, 108, 65", loss: "180, 45, 45" } as const;
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
    return { background: tint("gain", t) };
  }
  const m = Math.max(...all.map(Math.abs));
  if (m === 0 || v === 0) return {};
  return { background: tint(v > 0 ? "gain" : "loss", Math.abs(v) / m) };
}
