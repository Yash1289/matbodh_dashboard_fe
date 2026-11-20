import type { GridPayload } from "../api/types";
import type { CellGrid } from "../table/grid";
import { coverageNote, excludedNote, flagLegend, notAskedNote } from "./coverage";

/** The method line every card carries; shown under the card menu's method option, never on the card. */
export const methodNote = (p: { rules_version: string | number; engine_version: string | number; metadata_revision: number | string }, alliances?: number | string): string =>
  `Method: rules ${p.rules_version} · engine ${p.engine_version} · metadata r${p.metadata_revision}${alliances === undefined ? "" : ` · alliances e${alliances}`}`;

/** Coverage, exclusions, flags and the method line of a grid card, as plain notes; reports only what the API sent. */
export function gridNotes(payload: GridPayload, grid: CellGrid): string[] {
  const notes = [
    coverageNote(payload.rounds),
    excludedNote(payload),
    notAskedNote(payload),
    payload.hidden_count > 0 ? `${payload.hidden_count} values hidden` : null,
  ].filter((n): n is string => n !== null && n !== "");
  const flagText = flagLegend(grid).map((f) => (f.glyph ? `${f.glyph} ${f.reason}` : f.reason)).join(" · ");
  return [...notes, ...(flagText ? [flagText] : []), methodNote(payload, payload.alliance_epoch)];
}
