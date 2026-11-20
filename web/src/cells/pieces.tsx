import type { ReactNode } from "react";
import type { Cell, Unit } from "../api/types";
import { deltaTone } from "../theme";
import { flagInfo, formatDelta, nullReason } from "./format";

export const DASH = "—";
const TONE_COLOUR = { gain: "var(--mb-gain)", loss: "var(--mb-loss)", neutral: "var(--mb-muted)" } as const;

/** Reason a cell has no value; a missing cell is "not applicable". */
export const reasonOf = (cell: Cell | null): string => (cell === null ? "Not applicable" : nullReason(cell));

/** Title of a Δ: the round pair, plus the reason when the Δ is missing. */
export function cellDeltaTitle(cell: Cell | null, dTitle: string): string {
  if (cell !== null && cell.delta !== null) return dTitle;
  // The engine says why a comparison has no Δ even when the cell has its own value.
  const why = cell?.flags.find((f) => f === "missing_reference" || f === "missing_target");
  return `${dTitle}: ${cell === null || cell.value === null ? reasonOf(cell) : flagInfo(why ?? "no_delta").reason}`;
}

/** Δ in its tone colour; the ▲/▼ glyph from the formatter keeps it readable without colour. */
export function Delta({ delta, unit, title }: { delta: number | null; unit: Unit; title?: string }) {
  const tone = deltaTone(delta, unit);
  return (
    <span title={title} data-tone={tone} style={{ fontSize: "max(11px, .88em)", fontWeight: 600, color: TONE_COLOUR[tone] }}>
      {formatDelta(delta, unit)}
    </span>
  );
}

/** The "—" of a missing value, with its reason on hover. */
export function Dash({ title }: { title: string }) {
  return <span title={title} style={{ color: "var(--mb-muted)" }}>{DASH}</span>;
}

export function Flags({ flags }: { flags: string[] }) {
  return (
    <>
      {flags.map((f) => {
        const { glyph, reason } = flagInfo(f);
        if (!glyph) return null;
        return <span key={f} role="img" title={reason} aria-label={reason}>{glyph}</span>;
      })}
    </>
  );
}

/** Frame A cell: value left and Δ right on one baseline row, optional sub-line below. */
export function CellFrame({ value, delta, sub }: { value: ReactNode; delta: ReactNode; sub: ReactNode[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div data-row="main" style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: "1.2em", fontWeight: 600, color: "var(--mb-text)" }}>{value}</span>
        <span style={{ flex: 1 }} />
        {delta}
      </div>
      {sub.length > 0 && (
        <div data-row="sub" style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: "max(11px, .92em)", color: "var(--mb-muted)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}
