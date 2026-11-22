import type { Cut, GridDensity, GridPayload, RowDef } from "../../api/types";
import type { CellGrid, Header } from "../../table/grid";
import { payloadToGrid } from "./payloadToGrid";

/** The id of the one virtual cut a cascaded table is read from. */
export const CASCADE_CUT = "cascade";

export type Cascadability = { ok: true; chain: Cut[] } | { ok: false; reason: string };

const partsOf = (key: string): number => key.split("|").length;
const lastLabel = (r: RowDef): string => { const labels = Object.values(r.labels); return labels[labels.length - 1] ?? ""; };

/**
 * A table cascades when it is split by two or more fields and the table of each parent field exists: age group by
 * gender needs age group. `cutId` names the table; without it the deepest one is judged. A parent row is always a
 * row the engine returned.
 */
export function cascadable(cuts: Cut[], seatFields: ReadonlySet<string> = new Set(), cutId?: string): Cascadability {
  // A seat field that starts every table is the View by: the card reads one value of it at a time, so the tables
  // are judged as they are once it is removed.
  const lead = cuts.find((c) => c.dimensions.length > 0)?.dimensions[0];
  const viewBy = lead !== undefined && seatFields.has(lead) && cuts.every((c) => c.dimensions.length === 0 || c.dimensions[0] === lead);
  const tables = viewBy ? cuts.map((c) => (c.dimensions[0] === lead ? { ...c, dimensions: c.dimensions.slice(1) } : c)) : cuts;
  const reason = "Cascaded needs a table split by two or more fields, with the table of each parent field, such as age group and age group by gender";
  const selected = cutId !== undefined ? tables.find((c) => c.id === cutId)
    : [...tables].sort((a, b) => b.dimensions.length - a.dimensions.length)[0];
  if (selected === undefined || selected.dimensions.length < 2) return { ok: false, reason };
  const table = (dims: string[]) => tables.find((c) => c.dimensions.length === dims.length && c.dimensions.every((d, i) => d === dims[i]));
  const chain = selected.dimensions.map((_, i) => table(selected.dimensions.slice(0, i + 1)));
  return chain.every(Boolean) ? { ok: true, chain: chain as Cut[] } : { ok: false, reason };
}

/**
 * The chain's cuts as one virtual cut in tree order (each parent, then its children), plus each row's depth.
 * Every value is copied from the cut that owns the row: nothing is added up here. A category with one caste of
 * the same name stays one row, and a child whose parent row is missing is shown at the top level.
 */
export function cascadePayload(p: GridPayload, cutId?: string): { payload: GridPayload; depth: Record<string, number> } | null {
  const found = cascadable(p.cuts, undefined, cutId);
  if (!found.ok) return null;
  const { chain } = found;
  const rowsAt = (level: number) => chain[level].rows.filter((r) => partsOf(r.key) === level + 1);
  const rows: RowDef[] = [];
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
  for (const row of rowsAt(0)) walk(row, 0, 0);
  // A row whose parent row never appeared is not dropped: it starts a tree of its own at the top level.
  chain.forEach((_, level) => {
    for (const row of rowsAt(level)) {
      const parent = row.key.slice(0, row.key.lastIndexOf("|"));
      if (level > 0 && !owner.has(row.key) && !folded.has(row.key) && !owner.has(parent) && !folded.has(parent)) walk(row, level, 0);
    }
  });
  const mine = <T extends { row: string }>(pick: (c: Cut) => T[]) => chain.flatMap((c) => pick(c).filter((x) => owner.get(x.row) === c));
  const cut: Cut = {
    id: CASCADE_CUT, dimensions: chain[chain.length - 1].dimensions, rows,
    cells: mine((c) => c.cells), deltas: mine((c) => c.deltas), bases: mine((c) => c.bases),
    population: mine((c) => c.population ?? []),
  };
  return { payload: { ...p, cuts: [cut] }, depth };
}

/** The table a card shows: the cascaded tree when the view is Cascaded and the cuts nest, else the chosen cut. */
export function gridFor(p: GridPayload, view: { lens: string; cut: string; density: GridDensity }): CellGrid {
  const cascaded = view.density === "cascaded" ? cascadePayload(p, view.cut) : null;
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
