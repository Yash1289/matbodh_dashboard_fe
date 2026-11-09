import type { Cell, CellPart, RoundsBlock, Unit } from "../api/types";
import { flagInfo, formatDelta, formatTrendPipes, formatValue, nullReason } from "./format";
import { deltaTitle, seriesBreaks } from "./parts";
import { Sparkline } from "./Sparkline";

interface Props {
  cell: Cell | null;
  unit: Unit;
  parts: CellPart[];
  rounds: RoundsBlock;
}

const DASH = "—";

export function CompositeCell({ cell, unit, parts, rounds }: Props) {
  if (cell === null) return <span title="Not applicable">{DASH}</span>;
  const has = (p: CellPart) => parts.includes(p);
  const dTitle = deltaTitle(rounds);
  const names = rounds.items.map((r) => r.base_name).join(" | ");

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "baseline" }}>
      {has("value") &&
        (cell.value === null ? (
          <span title={nullReason(cell)}>{DASH}</span>
        ) : (
          <span>{formatValue(cell.value, unit)}</span>
        ))}
      {has("delta") && dTitle !== null && <span title={dTitle}>{formatDelta(cell.delta, unit)}</span>}
      {has("trend") &&
        cell.trend.length > 0 &&
        (cell.trend.length <= 4 ? (
          <span title={names}>{formatTrendPipes(cell.trend, unit)}</span>
        ) : (
          <span title={names}>
            <Sparkline values={cell.trend} breaks={seriesBreaks(rounds)} />
          </span>
        ))}
      {has("base") && cell.base !== null && cell.secondary === null && <span>n {cell.base}</span>}
      {has("secondary") && cell.secondary !== null && <span>{cell.secondary}</span>}
      {has("flags") &&
        cell.flags.map((f) => {
          const { glyph, reason } = flagInfo(f);
          return (
            <span key={f} title={reason} aria-label={reason}>
              {glyph}
            </span>
          );
        })}
    </span>
  );
}
