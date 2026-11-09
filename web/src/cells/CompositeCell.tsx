import type { Cell, CellPart, RoundsBlock, Unit } from "../api/types";
import { formatTrendPipes, formatValue } from "./format";
import { deltaTitle, seriesBreaks } from "./parts";
import { CellFrame, Dash, Delta, Flags, cellDeltaTitle, reasonOf } from "./pieces";
import { Sparkline } from "./Sparkline";

interface Props {
  cell: Cell | null;
  unit: Unit;
  parts: CellPart[];
  rounds: RoundsBlock;
}

export function CompositeCell({ cell, unit, parts, rounds }: Props) {
  if (cell === null) return <CellFrame value={<Dash title="Not applicable" />} delta={null} sub={[<span key="r">Not applicable</span>]} />;
  const has = (p: CellPart) => parts.includes(p);
  const dTitle = deltaTitle(rounds);
  const names = rounds.items.map((r) => r.base_name).join(" | ");
  const missing = cell.value === null;

  const sub = [];
  if (has("value") && missing) sub.push(<span key="reason">{reasonOf(cell)}</span>);
  if (has("trend") && cell.trend.length > 0) {
    sub.push(
      <span key="trend" title={names}>
        {cell.trend.length <= 4 ? formatTrendPipes(cell.trend, unit) : <Sparkline values={cell.trend} breaks={seriesBreaks(rounds)} />}
      </span>,
    );
  }
  if (has("base") && cell.base !== null && cell.secondary === null) sub.push(<span key="base">n {cell.base}</span>);
  if (has("secondary") && cell.secondary !== null) sub.push(<span key="secondary">{cell.secondary}</span>);
  if (has("flags")) sub.push(<Flags key="flags" flags={cell.flags} />);

  return (
    <CellFrame
      value={has("value") ? (missing ? <Dash title={reasonOf(cell)} /> : formatValue(cell.value, unit)) : null}
      delta={has("delta") && dTitle !== null ? <Delta delta={cell.delta} unit={unit} title={cellDeltaTitle(cell, dTitle)} /> : null}
      sub={sub}
    />
  );
}
