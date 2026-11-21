import type { Cell, Unit, PresentationRules } from "../api/types";

export type { PresentationRules };
export interface Header { key: string; label: string; colour: string | null; note?: string; sub?: string; width?: number }
/** `roundFlags` (trend mode): one flag list per round, aligned with `Cell.trend`. */
export interface GridCell { cell: Cell | null; unit: Unit; roundFlags?: string[][] }
export interface CellGrid {
  rows: Header[];
  columns: Header[];
  cells: Record<string, Record<string, GridCell>>;
  rowDim: string;
  columnDim: string;
  /** Card mode; absent means standalone. */
  mode?: "standalone" | "compare" | "trend";
  /** Trend mode: the round sub-labels, in the order of `Cell.trend`. */
  roundLabels?: string[];
  /** Compare mode: what every delta is measured against (a round label or a scenario). */
  referenceLabel?: string;
}
export interface SortSpec { column: string; part: "value" | "delta"; dir: "asc" | "desc" }

export function transpose(g: CellGrid): CellGrid {
  const cells: CellGrid["cells"] = {};
  for (const c of g.columns) {
    cells[c.key] = {};
    for (const r of g.rows) cells[c.key][r.key] = g.cells[r.key][c.key];
  }
  return { ...g, rows: g.columns, columns: g.rows, cells, rowDim: g.columnDim, columnDim: g.rowDim };
}

/** Reorders rows only; nulls last in both directions; stable; null restores apiOrder. */
export function sortRows(g: CellGrid, by: SortSpec | null, apiOrder: string[]): CellGrid {
  const byKey = new Map(g.rows.map((r) => [r.key, r]));
  const base = apiOrder.flatMap((k) => byKey.get(k) ?? []);
  if (by === null) return { ...g, rows: base };
  const val = (k: string): number | null => g.cells[k]?.[by.column]?.cell?.[by.part] ?? null;
  const sign = by.dir === "asc" ? 1 : -1;
  const rows = [...base].sort((a, b) => {
    const x = val(a.key), y = val(b.key);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * (x - y);
  });
  return { ...g, rows };
}

/**
 * `keyOf` names the item a header stands for; the default is its own key. Several headers can stand for one
 * item (the same party under two questions): each is kept, in the item's place in the order.
 */
function reorderHeaders(headers: Header[], specifiedOrder?: string[], pinLast?: string[], colors?: Record<string, string>,
  keyOf: (h: Header) => string = (h) => h.key): Header[] {
  const byItem = new Map<string, Header[]>();
  for (const h of headers) byItem.set(keyOf(h), [...(byItem.get(keyOf(h)) ?? []), h]);
  const pinnedSet = new Set(pinLast ?? []);
  const specifiedSet = new Set(specifiedOrder ?? []);
  const seen = new Set<string>();
  const ordered: Header[] = [];
  const take = (item: string) => { ordered.push(...(byItem.get(item) ?? [])); seen.add(item); };

  // 1. Specified items (excluding any explicitly pinned to end)
  for (const k of (specifiedOrder ?? [])) if (byItem.has(k) && !pinnedSet.has(k) && !seen.has(k)) take(k);
  // 2. Unlisted items (not specified and not pinned), in their own order
  for (const h of headers) {
    const k = keyOf(h);
    if (!specifiedSet.has(k) && !pinnedSet.has(k) && !seen.has(k)) take(k);
  }
  // 3. Pinned items
  for (const k of (pinLast ?? [])) if (byItem.has(k) && !seen.has(k)) take(k);

  // Apply entity colors
  return ordered.map((h) => ({
    ...h,
    colour: colors?.[keyOf(h)] ?? h.colour,
  }));
}

/**
 * `columnKey` and `rowKey` map a header to the name the rules use: payload columns are
 * `scenario:party` and rows are `dimension=value`, while rules name the bare party or value.
 */
export function applyPresentationRules(grid: CellGrid, rules?: PresentationRules | null,
  columnKey?: (h: Header) => string, rowKey?: (h: Header) => string): CellGrid {
  if (!rules) return grid;
  const columns = reorderHeaders(grid.columns, rules.columnOrder, rules.pinLast, rules.entityColors, columnKey);
  const rowOrder = Array.isArray(rules.rowOrder)
    ? rules.rowOrder
    : (rules.rowOrder && grid.rowDim ? rules.rowOrder[grid.rowDim] : undefined);
  const rows = reorderHeaders(grid.rows, rowOrder, undefined, undefined, rowKey);
  return {
    ...grid,
    rows,
    columns,
  };
}
