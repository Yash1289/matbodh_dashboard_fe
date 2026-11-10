import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import type { CellPart, RoundsBlock } from "../api/types";
import { CompositeCell } from "../cells/CompositeCell";
import { PipeCell } from "../cells/PipeCell";
import { SeatsCell } from "../cells/SeatsCell";
import { tokens } from "../theme";
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

const BORDER = "1px solid var(--mb-border)";
// The header and the row labels stay in view while the table scrolls.
const HEADER_CELL = { background: "var(--mb-header-bg)", borderBottom: BORDER, padding: "10px 8px", textAlign: "left", verticalAlign: "top", fontWeight: 600, position: "sticky", top: 0, zIndex: 2 } as const;
const STICKY_LABEL = { position: "sticky", left: 0, zIndex: 1, background: "var(--mb-surface)" } as const;
const ROW_LIMIT = 100;
const BODY_CELL = { borderBottom: BORDER, padding: "10px 8px", textAlign: "left", verticalAlign: "top" } as const;
const ROW_LABEL_WIDTH = 150;
const OTHER_LABEL_WIDTH = 200;

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
            <span style={{ fontSize: tokens.font.rowLabel, fontWeight: 600, color: "var(--mb-text)" }}>{row.original.label}</span>
            {row.original.note && <small style={{ display: "block", color: "var(--mb-muted)" }}>{row.original.note}</small>}
          </>
        ),
      }),
      ...ordered.columns.map((c) =>
        col.display({
          id: c.key,
          header: () => (
            <button type="button" onClick={() => onSort(nextSort(sort, c.key))} style={{ ...BUTTON_STYLE, color: "var(--mb-muted)", fontSize: tokens.font.tableHeader, fontWeight: 600 }}>
              <Swatch colour={c.colour} />
              {c.label}
              {sort?.column === c.key && sort.part === "value" ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
              {c.sub && <span style={{ display: "block", fontSize: tokens.font.headerSub, fontWeight: 400 }}>{c.sub}</span>}
              {c.note && <small style={{ display: "block", fontWeight: 400 }}>{c.note}</small>}
            </button>
          ),
          cell: ({ row }) => {
            const gc = ordered.cells[row.original.key]?.[c.key];
            if (gc?.pcCell !== undefined) return <SeatsCell ac={gc.cell} pc={gc.pcCell} parts={parts} rounds={rounds} />;
            if (grid.mode === "trend" && gc?.cell) {
              return <PipeCell values={gc.cell.trend} unit={gc.unit} labels={grid.roundLabels ?? []} flags={gc.roundFlags ?? []} />;
            }
            const deltaLabel = grid.mode === "compare" && grid.referenceLabel ? `Δ vs ${grid.referenceLabel}` : undefined;
            return <CompositeCell cell={gc?.cell ?? null} unit={gc?.unit ?? "pct"} parts={parts} rounds={rounds} deltaLabel={deltaLabel} />;
          },
        }),
      ),
    ],
    [ordered, grid.rowDim, grid.mode, grid.roundLabels, grid.referenceLabel, parts, rounds, sort, onSort],
  );

  const table = useReactTable({ data: ordered.rows, columns, getCoreRowModel: getCoreRowModel() });
  const [shown, setShown] = useState(ROW_LIMIT);
  const allRows = table.getRowModel().rows;
  const rows = allRows.slice(0, shown);
  const caption = grid.mode === "trend"
    ? `Rounds: ${rounds.items.map((r) => r.base_name).join(" | ")}`
    : `Anchor round: ${anchor}${grid.mode === "compare" && grid.referenceLabel ? ` · Δ vs ${grid.referenceLabel}` : ""}`;

  const widths = new Map(ordered.columns.map((c) => [c.key, c.width]));
  const fixed = ordered.columns.some((c) => c.width !== undefined);
  const widthOf = (id: string): number | undefined => (id === "__row" ? (fixed ? ROW_LABEL_WIDTH : OTHER_LABEL_WIDTH) : widths.get(id));

  return (
    <div>
      <div style={{ overflow: "auto", maxHeight: "70vh", scrollPaddingTop: 56, scrollPaddingLeft: ROW_LABEL_WIDTH }}>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: fixed ? "fixed" : "auto" }}>
          <caption>{caption}</caption>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} scope="col" style={{ ...HEADER_CELL, ...(h.column.id === "__row" ? { left: 0, zIndex: 3 } : {}), width: widthOf(h.column.id) }} aria-sort={h.column.id === "__row" ? undefined : ariaSort(sort, h.column.id)}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {r.getVisibleCells().map((c) =>
                  c.column.id === "__row" ? (
                    <th key={c.id} scope="row" style={{ ...BODY_CELL, ...STICKY_LABEL, width: widthOf("__row") }}>{flexRender(c.column.columnDef.cell, c.getContext())}</th>
                  ) : (
                    <td key={c.id} style={{ ...BODY_CELL, ...cellStyle(ordered, r.original.key, c.column.id, rule) }}>
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {allRows.length > shown && (
        <p>
          Showing {shown} of {allRows.length} rows{" "}
          <button type="button" onClick={() => setShown(shown + ROW_LIMIT)}>Show {ROW_LIMIT} more</button>
        </p>
      )}
      {key && <p>{key.range === null ? key.label : `${key.label}: ${key.range}`}</p>}
    </div>
  );
}
