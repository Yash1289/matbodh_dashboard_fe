import type { Cell, Unit } from "../api/types";

const DASH = "—";
const MINUS = "−";

/** The single implementation of the percentage rule: |v| >= 2 -> whole number, else two decimals. */
export function formatPercent(v: number): string {
  const abs = Math.abs(v);
  const digits = abs >= 2 ? String(Math.round(abs)) : abs.toFixed(2);
  const isZero = /^[0.]+$/.test(digits);
  return `${v < 0 && !isZero ? MINUS : ""}${digits}%`;
}

const isZeroText = (s: string): boolean => /^[0.]+%?$/.test(s);

export function formatValue(v: number | null, unit: Unit): string {
  if (v === null) return DASH;
  if (unit === "seats") return String(Math.round(v));
  const text = formatPercent(v);
  return unit === "pp" && v > 0 && !isZeroText(text) ? `+${text}` : text;
}

export function formatDelta(d: number | null, unit: Unit): string {
  if (d === null) return DASH;
  const body = unit === "seats" ? String(Math.round(Math.abs(d))) : formatPercent(Math.abs(d));
  if (isZeroText(body)) return body;
  return `${d > 0 ? "▲" : "▼"}${body}`;
}

export function formatTrendPipes(trend: (number | null)[], unit: Unit): string {
  return trend.map((v) => formatValue(v, unit)).join(" | ");
}

export const FLAG_INFO: Record<string, { glyph: string; reason: string }> = {
  not_asked: { glyph: "—", reason: "Not asked in this round" },
  failed: { glyph: "—", reason: "Calculation failed for this round" },
  not_contender: { glyph: "—", reason: "Not a seat contender" },
  no_delta: { glyph: "", reason: "No Δ available for this round pair" },
  null_value: { glyph: "—", reason: "No value returned" },
  missing_target: { glyph: "—", reason: "No value in the target round" },
  missing_reference: { glyph: "—", reason: "No value in the reference, so no Δ" },
  not_covered: { glyph: "—", reason: "Seat not covered in both rounds" },
  no_eligible_result: { glyph: "—", reason: "No eligible result for this question" },
  within_other: { glyph: "⊂", reason: "Already counted inside Other" },
  vote_from_seat_view: { glyph: "†", reason: "Vote share from the seat view" },
  borrowed: { glyph: "*", reason: "Includes seats carried from an earlier round" },
  low_base: { glyph: "◌", reason: "Low base" },
};

export function flagInfo(flag: string): { glyph: string; reason: string } {
  return FLAG_INFO[flag] ?? { glyph: "?", reason: flag };
}

const NULL_FLAG_ORDER = ["failed", "not_asked", "no_eligible_result", "missing_target",
  "missing_reference", "not_covered", "not_contender", "null_value"];

export function nullReason(cell: Cell): string {
  const hit = NULL_FLAG_ORDER.find((f) => cell.flags.includes(f));
  return flagInfo(hit ?? "null_value").reason;
}
