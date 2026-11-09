import type { Cell, CardResult, Unit } from "../api/types";

export interface Header { key: string; label: string; colour: string | null; note?: string }
export interface GridCell { cell: Cell | null; unit: Unit }
export interface CellGrid {
  rows: Header[];
  columns: Header[];
  cells: Record<string, Record<string, GridCell>>;
  rowDim: string;
  columnDim: string;
}
export interface SortSpec { column: string; part: "value" | "delta"; dir: "asc" | "desc" }

const NO_RESULT = "No result returned";

function build(rows: Header[], columns: Header[], unitOf: (colKey: string) => Unit,
  get: (r: string, c: string) => Cell | null, rowDim: string, columnDim: string): CellGrid {
  const cells: CellGrid["cells"] = {};
  for (const r of rows) {
    cells[r.key] = {};
    for (const c of columns) cells[r.key][c.key] = { cell: get(r.key, c.key), unit: unitOf(c.key) };
  }
  return { rows, columns, cells, rowDim, columnDim };
}

const SCOREBOARD_COLUMNS = [
  { key: "vote", label: "Vote share", unit: "pct", note: undefined },
  { key: "seats_ac", label: "Seats AC", unit: "seats", note: undefined },
  { key: "seats_pc", label: "Seats PC", unit: "seats", note: undefined },
  { key: "gender_gap", label: "Gender gap", unit: "pp", note: "women − men" },
] as const;

export function scoreboardGrid(result: CardResult): CellGrid {
  const data = result.scoreboard ?? [];
  const rows: Header[] = data.map((r) => ({
    key: r.series, label: r.label, colour: r.colour,
    ...(r.flags.includes("within_other") ? { note: "within Other" } : {}),
  }));
  const columns: Header[] = [];
  for (const c of SCOREBOARD_COLUMNS) {
    const reason = result.unavailable.find((u) => u.part === c.key)?.reason;
    const present = c.key === "vote" || data.some((r) => r[c.key] !== null) || reason !== undefined;
    if (!present) continue;
    columns.push({ key: c.key, label: c.label, colour: null, ...(reason ?? c.note ? { note: reason ?? c.note } : {}) });
  }
  const byKey = new Map(data.map((r) => [r.series, r]));
  const unit = (k: string): Unit => SCOREBOARD_COLUMNS.find((c) => c.key === k)!.unit;
  const get = (r: string, c: string): Cell | null => byKey.get(r)?.[c as "vote"] ?? null;
  return build(rows, columns, unit, get, "series", "measure");
}

export function opinionGrid(result: CardResult): CellGrid {
  const data = result.opinion ?? [];
  const rows: Header[] = [
    ...data.map((r) => ({ key: r.series, label: r.label, colour: r.colour })),
    ...(result.not_returned ?? []).map((q) => ({ key: q, label: q, colour: null, note: NO_RESULT })),
    ...result.unavailable.map((u) => ({ key: u.part, label: u.part, colour: null, note: u.reason })),
  ];
  const byKey = new Map(data.map((r) => [r.series, r.cell]));
  const columns: Header[] = [{ key: "net_score", label: "Net score", colour: null }];
  return build(rows, columns, () => "pp", (r) => byKey.get(r) ?? null, "question", "measure");
}

export function zoneGrid(result: CardResult): CellGrid {
  const g = result.grid ?? { row_dim: "", rows: [] };
  const rows: Header[] = g.rows.map((r) => ({ key: r.value ?? "__null__", label: r.label ?? "(no value)", colour: null }));
  const columns: Header[] = [];
  const cellOf = new Map<string, Cell | null>();
  g.rows.forEach((r, i) => {
    for (const s of r.series) {
      if (!columns.some((c) => c.key === s.series)) columns.push({ key: s.series, label: s.label, colour: s.colour });
      cellOf.set(`${rows[i].key}\u0000${s.series}`, s.cell);
    }
  });
  return build(rows, columns, () => "pct", (r, c) => cellOf.get(`${r}\u0000${c}`) ?? null, g.row_dim, "series");
}

export function gridFor(result: CardResult): CellGrid {
  if (result.operation === "scoreboard") return scoreboardGrid(result);
  if (result.operation === "opinion") return opinionGrid(result);
  return zoneGrid(result);
}

export function transpose(g: CellGrid): CellGrid {
  const cells: CellGrid["cells"] = {};
  for (const c of g.columns) {
    cells[c.key] = {};
    for (const r of g.rows) cells[c.key][r.key] = g.cells[r.key][c.key];
  }
  return { rows: g.columns, columns: g.rows, cells, rowDim: g.columnDim, columnDim: g.rowDim };
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
