import type { CardResult, RoundsBlock, Template } from "../api/types";
import { FLAG_INFO, flagInfo } from "../cells/format";
import type { CellGrid } from "../table/grid";

export const PART_LABELS: Record<string, string> = {
  vote: "Vote share",
  gender_gap: "Gender gap",
  seats_ac: "Seats AC",
  seats_pc: "Seats PC",
  parties: "Party list",
  zone: "Zones",
};

/** Fixed label, else the result row label (opinion questions), else the raw id. */
export function partLabel(part: string, result: CardResult | null): string {
  return PART_LABELS[part] ?? result?.opinion?.find((r) => r.series === part)?.label ?? part;
}

/** The parts a card asks for; mirrors the backend's `card_parts`. */
export function cardParts(t: Template): string[] {
  if (t.operation === "scoreboard") return ["vote", "gender_gap", "seats_ac", "seats_pc"];
  if (t.operation === "opinion") return t.questions;
  return ["zone"];
}

const SEAT_SLICES = new Set(["party_zone", "zone", "district", "pc_num", "ac_num"]);
export const isSeatCard = (t: Template): boolean =>
  t.operation === "scoreboard" || t.slices.some((s) => SEAT_SLICES.has(s));

export function coverageNote(rounds: RoundsBlock): string {
  return rounds.items
    .map((r) => `${r.base_name}: ${r.seats} seats · ${r.version === "extrapolated" ? "Extrapolated" : "Normal"}`
      + (r.fallback ? " (no Extrapolated version)" : ""))
    .join(" · ");
}

const joinOrNull = (parts: string[]): string | null => (parts.length ? parts.join(" · ") : null);

export function excludedNote(result: CardResult): string | null {
  const name = (key: string) =>
    result.rounds.items.find((r) => r.obs_id === key || r.base_name === key)?.base_name ?? key;
  const out = new Set<string>();
  for (const { coverage } of result.coverage) {
    // A string coverage (contract name only) carries no exclusions.
    if (typeof coverage !== "object" || coverage === null) continue;
    const excluded = coverage.excluded_by_observation;
    if (typeof excluded !== "object" || excluded === null) continue;
    for (const [key, seats] of Object.entries(excluded)) {
      if (Array.isArray(seats) && seats.length > 0) out.add(`${seats.length} seats excluded in ${name(key)}`);
    }
  }
  return joinOrNull([...out]);
}

export function notAskedNote(result: CardResult): string | null {
  return joinOrNull(result.not_asked.map((n) => `${partLabel(n.part, result)} not asked in ${n.rounds.join(", ")}`));
}

const FLAG_ORDER = Object.keys(FLAG_INFO);

export function flagLegend(g: CellGrid): { glyph: string; reason: string }[] {
  const present = new Set<string>();
  for (const row of Object.values(g.cells)) for (const gc of Object.values(row)) gc.cell?.flags.forEach((f) => present.add(f));
  const rank = (f: string) => (FLAG_ORDER.includes(f) ? FLAG_ORDER.indexOf(f) : FLAG_ORDER.length);
  return [...present].sort((a, b) => rank(a) - rank(b)).map(flagInfo);
}
