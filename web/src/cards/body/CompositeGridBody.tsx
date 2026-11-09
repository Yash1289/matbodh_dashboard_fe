import type { CellPart, RoundsBlock } from "../../api/types";
import { CompositeTable } from "../../table/CompositeTable";
import type { FormatRule } from "../../table/formatRules";
import type { CellGrid, SortSpec } from "../../table/grid";

export interface CompositeGridBodyProps {
  grid: CellGrid;
  parts: CellPart[];
  rounds: RoundsBlock;
  rule: FormatRule;
  sort: SortSpec | null;
  onSort: (s: SortSpec | null) => void;
}

export function CompositeGridBody({
  grid,
  parts,
  rounds,
  rule,
  sort,
  onSort,
}: CompositeGridBodyProps) {
  return (
    <CompositeTable
      grid={grid}
      parts={parts}
      rounds={rounds}
      rule={rule}
      sort={sort}
      onSort={onSort}
    />
  );
}
