import type { GridPayload, RoundsBlock } from "../api/types";
import { FLAG_INFO, flagInfo } from "../cells/format";
import type { CellGrid } from "../table/grid";

export function coverageNote(rounds: RoundsBlock): string {
  return rounds.items
    .map((r) => `${r.base_name}: ${r.seats} seats · ${r.version === "extrapolated" ? "Extrapolated" : "Normal"}`
      + (r.fallback ? " (no Extrapolated version)" : ""))
    .join(" · ");
}

const joinOrNull = (parts: string[]): string | null => (parts.length ? parts.join(" · ") : null);

export function excludedNote(payload: GridPayload): string | null {
  const name = (key: string) =>
    payload.rounds.items.find((r) => r.obs_id === key || r.base_name === key)?.base_name ?? key;
  const out = new Set<string>();
  for (const { coverage } of payload.coverage) {
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

/** Rounds in which the card's scenario was not asked; they show as dashes, never as zero. */
export function notAskedNote(payload: GridPayload): string | null {
  return joinOrNull(payload.not_asked.map((n) => `Not asked in ${n.rounds.join(", ")}`));
}

const FLAG_ORDER = Object.keys(FLAG_INFO);

export function flagLegend(g: CellGrid): { glyph: string; reason: string }[] {
  const present = new Set<string>();
  for (const row of Object.values(g.cells)) for (const gc of Object.values(row)) gc.cell?.flags.forEach((f) => present.add(f));
  const rank = (f: string) => (FLAG_ORDER.includes(f) ? FLAG_ORDER.indexOf(f) : FLAG_ORDER.length);
  return [...present].sort((a, b) => rank(a) - rank(b)).map(flagInfo);
}
