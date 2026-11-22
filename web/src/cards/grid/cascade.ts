import type { Cut, GridDensity, GridPayload, RowDef } from "../../api/types";
import type { CellGrid, Header } from "../../table/grid";
import { payloadToGrid } from "./payloadToGrid";

/** The id of the one virtual cut a cascaded table is read from. */
export const CASCADE_CUT = "cascade";

export type Cascadability = { ok: true; chain: Cut[] } | { ok: false; reason: string };

const partsOf = (key: string): number => key.split("|").length;
const lastLabel = (r: RowDef): string => { const labels = Object.values(r.labels); return labels[labels.length - 1] ?? ""; };

/**
 * Cuts cascade when they form a chain: [a], [a, b], [a, b, c], each starting from the previous one, with every
 * parent cut present. The Overall cut is left out. A parent row is always a row the engine returned.
 */
export function cascadable(cuts: Cut[], seatFields: ReadonlySet<string> = new Set()): Cascadability {
  // A seat field that starts every table is the View by: the card reads one value of it at a time, so the tables
  // are judged as they are once it is removed.
  const lead = cuts.find((c) => c.dimensions.length > 0)?.dimensions[0];
  const viewBy = lead !== undefined && seatFields.has(lead) && cuts.every((c) => c.dimensions.length === 0 || c.dimensions[0] === lead);
  const tables = viewBy ? cuts.map((c) => (c.dimensions[0] === lead ? { ...c, dimensions: c.dimensions.slice(1) } : c)) : cuts;
  const chain = tables.filter((c) => c.dimensions.length > 0).sort((a, b) => a.dimensions.length - b.dimensions.length);
  const startsFrom = "Cascaded needs cuts that start from the previous one, such as age group, then age group by gender";
  if (chain.length < 2) return { ok: false, reason: startsFrom };
  const nested = chain.every((c, i) => c.dimensions.length === i + 1
    && (i === 0 || chain[i - 1].dimensions.every((d, j) => d === c.dimensions[j])));
  if (!nested) return { ok: false, reason: startsFrom };
  return { ok: true, chain };
}

/**
 * The chain's cuts as one virtual cut in tree order (each parent, then its children), plus each row's depth.
 * Every value is copied from the cut that owns the row: nothing is added up here. A category with one caste of
 * the same name stays one row, and a child whose parent row is missing is shown at the top level.
 */
export function cascadePayload(p: GridPayload, seatFields?: ReadonlySet<string>): { payload: GridPayload; depth: Record<string, number> } | null {
  const found = cascadable(p.cuts, seatFields);
  if (!found.ok) return null;
  const { chain } = found;
  const rowsAt = (level: number) => chain[level].rows.filter((r) => partsOf(r.key) === level + 1);
  const rows: RowDef[] = [];
  const overall = p.cuts.find((cut) => cut.dimensions.length === 0);
  const sources: Cut[] = overall ? [overall, ...chain] : chain;
  const owner = new Map<string, Cut>();
  const folded = new Set<string>(); // same-named only children shown as their parent's row
  const depth: Record<string, number> = {};
  const emit = (row: RowDef, from: Cut, at: number) => {
    rows.push(row);
    owner.set(row.key, from);
    depth[row.key] = at;
  };
  const walk = (row: RowDef, level: number, at: number, fold = false) => {
    if (fold) folded.add(row.key); else emit(row, chain[level], at);
    if (level + 1 >= chain.length) return;
    const children = rowsAt(level + 1).filter((r) => r.key.startsWith(`${row.key}|`));
    // A same-named only child is this row; its own children hang under this row.
    if (children.length === 1 && lastLabel(children[0]) === lastLabel(row)) return walk(children[0], level + 1, at, true);
    for (const child of children) walk(child, level + 1, at + 1);
  };
  // The Overall row, when the card has one, opens the table; its own value, not a total made here.
  for (const row of overall?.rows ?? []) emit(row, overall!, 0);
  for (const row of rowsAt(0)) walk(row, 0, 0);
  // A row whose parent row never appeared is not dropped: it starts a tree of its own at the top level.
  chain.forEach((_, level) => {
    for (const row of rowsAt(level)) {
      const parent = row.key.slice(0, row.key.lastIndexOf("|"));
      if (level > 0 && !owner.has(row.key) && !folded.has(row.key) && !owner.has(parent) && !folded.has(parent)) walk(row, level, 0);
    }
  });
  const mine = <T extends { row: string }>(pick: (c: Cut) => T[]) => sources.flatMap((c) => pick(c).filter((x) => owner.get(x.row) === c));
  const cut: Cut = {
    id: CASCADE_CUT, dimensions: chain[chain.length - 1].dimensions, rows,
    cells: mine((c) => c.cells), deltas: mine((c) => c.deltas), bases: mine((c) => c.bases),
    population: mine((c) => c.population ?? []),
  };
  return { payload: { ...p, cuts: [cut] }, depth };
}

/** The table a card shows: the cascaded tree when the view is Cascaded and the cuts nest, else the chosen cut. */
export function gridFor(p: GridPayload, view: { lens: string; cut: string; density: GridDensity }): CellGrid {
  const cascaded = view.density === "cascaded" ? cascadePayload(p) : null;
  return cascaded
    ? payloadToGrid(cascaded.payload, { lens: view.lens, cut: CASCADE_CUT, cascade: cascaded.depth })
    : payloadToGrid(p, { lens: view.lens, cut: view.cut });
}

/** Search in a tree: a matching row stays together with the parent rows above it. */
export function keepWithAncestors(rows: Header[], matches: (row: Header) => boolean): Header[] {
  const keep = new Set<number>();
  rows.forEach((row, i) => {
    if (!matches(row)) return;
    keep.add(i);
    let need = row.depth ?? 0;
    for (let j = i - 1; j >= 0 && need > 0; j--) {
      const depth = rows[j].depth ?? 0;
      if (depth < need) { keep.add(j); need = depth; }
    }
  });
  return rows.filter((_, i) => keep.has(i));
}
