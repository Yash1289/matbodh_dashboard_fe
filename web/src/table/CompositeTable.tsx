import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useMemo } from "react";
import type { CellPart, RoundsBlock } from "../api/types";
import { CompositeCell } from "../cells/CompositeCell";
import { cellStyle, legend, type FormatRule } from "./formatRules";
import { sortRows, type CellGrid, type Header, type SortSpec } from "./grid";

interface Props {
  grid: CellGrid;
  parts: CellPart[];
  rounds: RoundsBlock;
  rule: FormatRule;
  sort: SortSpec | null;
  onSort: (next: SortSpec | null) => void;
}

const col = createColumnHelper<Header>();

function nextSort(current: SortSpec | null, column: string): SortSpec | null {
  if (current?.column !== column || current.part !== "value") return { column, part: "value", dir: "desc" };
  return current.dir === "desc" ? { column, part: "value", dir: "asc" } : null;
}

// Reset the look but keep the browser's focus-visible ring (no `all: unset`).
const BUTTON_STYLE = { background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", textAlign: "inherit", cursor: "pointer" } as const;

const ariaSort = (sort: SortSpec | null, column: string) =>
  sort?.column === column && sort.part === "value" ? (sort.dir === "desc" ? "descending" : "ascending") : "none";

const Swatch = ({ colour }: { colour: string | null }) =>
  colour === null ? null : <span aria-hidden style={{ background: colour, display: "inline-block", width: 10, height: 10, marginRight: 6 }} />;

export function CompositeTable({ grid, parts, rounds, rule, sort, onSort }: Props) {
  const apiOrder = useMemo(() => grid.rows.map((r) => r.key), [grid.rows]);
  const ordered = useMemo(() => sortRows(grid, sort, apiOrder), [grid, sort, apiOrder]);
  const anchor = rounds.items.find((r) => r.obs_id === rounds.anchor)?.base_name ?? rounds.anchor;
  const key = legend(grid, rule);

  const columns = useMemo(
    () => [
      col.display({
        id: "__row",
        header: grid.rowDim,
        cell: ({ row }) => (
          <>
            <Swatch colour={row.original.colour} />
            {row.original.label}
            {row.original.note && <small style={{ display: "block", opacity: 0.7 }}>{row.original.note}</small>}
          </>
        ),
      }),
      ...ordered.columns.map((c) =>
        col.display({
          id: c.key,
          header: () => (
            <button type="button" onClick={() => onSort(nextSort(sort, c.key))} style={BUTTON_STYLE}>
              <Swatch colour={c.colour} />
              {c.label}
              {sort?.column === c.key && sort.part === "value" ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
              {c.note && <small style={{ display: "block", opacity: 0.7 }}>{c.note}</small>}
            </button>
          ),
          cell: ({ row }) => {
            const gc = ordered.cells[row.original.key]?.[c.key];
            return <CompositeCell cell={gc?.cell ?? null} unit={gc?.unit ?? "pct"} parts={parts} rounds={rounds} />;
          },
        }),
      ),
    ],
    [ordered, grid.rowDim, parts, rounds, sort, onSort],
  );

  const table = useReactTable({ data: ordered.rows, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div>
      <table>
        <caption>Anchor round: {anchor}</caption>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} scope="col" aria-sort={h.column.id === "__row" ? undefined : ariaSort(sort, h.column.id)}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id}>
              {r.getVisibleCells().map((c) =>
                c.column.id === "__row" ? (
                  <th key={c.id} scope="row">{flexRender(c.column.columnDef.cell, c.getContext())}</th>
                ) : (
                  <td key={c.id} style={cellStyle(ordered, r.original.key, c.column.id, rule)}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {key && <p>{key.range === null ? key.label : `${key.label}: ${key.range}`}</p>}
    </div>
  );
}
