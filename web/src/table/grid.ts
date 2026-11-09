import type { Cell, CardResult, Unit } from "../api/types";

export interface Header { key: string; label: string; colour: string | null; note?: string; sub?: string; width?: number }
/** `pcCell` is set only on the merged seats column: `cell` is then the AC level. */
export interface GridCell { cell: Cell | null; unit: Unit; pcCell?: Cell | null }
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

const SEAT_PARTS = ["seats_ac", "seats_pc"] as const;

export function scoreboardGrid(result: CardResult): CellGrid {
  const data = result.scoreboard ?? [];
  const labels = result.rounds.items.map((r) => r.label).join(" | ");
  const reasonOf = (...parts: string[]): string | undefined => {
    const hits = [...new Set(result.unavailable.filter((u) => parts.includes(u.part)).map((u) => u.reason))];
    return hits.length ? hits.join("; ") : undefined;
  };
  const rows: Header[] = data.map((r) => ({
    key: r.series, label: r.label, colour: r.colour,
    ...(r.flags.includes("within_other") ? { note: "within Other" } : {}),
  }));
  const columns: Header[] = [{ key: "vote", label: "Vote share", colour: null, sub: `% · Δ pp · trend ${labels}`, width: 240, ...noteOf(reasonOf("vote")) }];
  const seatsReason = reasonOf(...SEAT_PARTS);
  if (seatsReason !== undefined || data.some((r) => r.seats_ac !== null || r.seats_pc !== null)) {
    columns.push({ key: "seats", label: "Seats  AC · PC", colour: null, sub: "AC · PC · Δ seats", width: 240, ...noteOf(seatsReason) });
  }
  const gapReason = reasonOf("gender_gap");
  if (gapReason !== undefined || data.some((r) => r.gender_gap !== null)) {
    columns.push({ key: "gender_gap", label: "Gender gap", colour: null, sub: "F − M, pp · Δ · F / M shares", width: 220, ...noteOf(gapReason) });
  }
  const byKey = new Map(data.map((r) => [r.series, r]));
  const unit = (k: string): Unit => (k === "vote" ? "pct" : k === "seats" ? "seats" : "pp");
  const cells: CellGrid["cells"] = {};
  for (const r of rows) {
    cells[r.key] = {};
    const row = byKey.get(r.key);
    for (const c of columns) {
      cells[r.key][c.key] = c.key === "seats"
        ? { cell: row?.seats_ac ?? null, pcCell: row?.seats_pc ?? null, unit: "seats" }
        : { cell: row?.[c.key as "vote" | "gender_gap"] ?? null, unit: unit(c.key) };
    }
  }
  return { rows, columns, cells, rowDim: "series", columnDim: "measure" };
}

const noteOf = (note: string | undefined): { note?: string } => (note === undefined ? {} : { note });

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

export function zoneGrid(result: CardResult, lens?: string): CellGrid {
  const g = result.grid ?? { row_dim: "", rows: [] };
  const rows: Header[] = g.rows.map((r) => ({ key: r.value ?? "__null__", label: r.label ?? "(no value)", colour: null }));
  const columns: Header[] = [];
  const cellOf = new Map<string, Cell | null>();
  g.rows.forEach((r, i) => {
    for (const s of r.series) {
      if (!columns.some((c) => c.key === s.series)) columns.push({ key: s.series, label: s.label, colour: s.colour });
      const cell = s.lenses && lens && lens in s.lenses ? s.lenses[lens] : s.cell;
      cellOf.set(`${rows[i].key}\u0000${s.series}`, cell);
    }
  });
  const unit: Unit = (lens === "size_of_impact_pp" || lens === "net_score") ? "pp" : "pct";
  return build(rows, columns, () => unit, (r, c) => cellOf.get(`${r}\u0000${c}`) ?? null, g.row_dim, "series");
}

export function gridFor(result: CardResult, lens?: string): CellGrid {
  if (result.operation === "scoreboard") return scoreboardGrid(result);
  if (result.operation === "opinion") return opinionGrid(result);
  return zoneGrid(result, lens);
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
