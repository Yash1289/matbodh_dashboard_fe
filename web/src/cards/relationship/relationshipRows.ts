import type { RelationshipCell, RelationshipGroup, RelationshipPayload, RelationshipSummary, RelationshipTable } from "../../api/types";

/** Display state of one relationship card. Changing any of it is in-memory: it never starts a request. */
export interface RelationshipView {
  table: RelationshipTable;
  round: string | null; // matrix: the observation id shown
  cut: string | null; // the grouping set (set_id) shown
  values: Record<string, string>; // matrix: the chosen value per dimension of the cut
  search: string;
  showDetails: boolean;
}

export interface MatrixRow {
  key: string;
  origin: string;
  destination: string;
  stayed: boolean; // origin and destination are the same party
  focal: boolean; // the focal party is the origin or the destination
  cell: RelationshipCell;
}

export interface SummaryRow {
  key: string;
  group: RelationshipGroup;
  label: string;
  byRound: Record<string, RelationshipSummary | undefined>;
}

const sameDimensions = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
};

/** Observation ids that have data, in the payload's round order. */
export const roundsWithData = (p: RelationshipPayload): string[] => {
  const present = new Set(p.summaries.map((s) => s.round));
  return p.rounds.items.map((i) => i.obs_id).filter((o) => present.has(o));
};

export const initialRelationshipView = (p: RelationshipPayload): RelationshipView => {
  const rounds = roundsWithData(p);
  const first = p.groups[0];
  return {
    table: p.default_table, round: rounds.includes(p.rounds.anchor) ? p.rounds.anchor : rounds[0] ?? null,
    cut: first?.set_id ?? null, values: { ...(first?.dimensions ?? {}) }, search: "", showDetails: false,
  };
};

export const cutsOf = (p: RelationshipPayload): { key: string; dimensions: string[] }[] => {
  const seen = new Map<string, string[]>();
  for (const g of p.groups) if (!seen.has(g.set_id)) seen.set(g.set_id, Object.keys(g.dimensions));
  return [...seen].map(([key, dimensions]) => ({ key, dimensions }));
};

export const valuesFor = (p: RelationshipPayload, cut: string, dimension: string): string[] =>
  [...new Set(p.groups.filter((g) => g.set_id === cut && dimension in g.dimensions).map((g) => g.dimensions[dimension]))];

/** The matrix rows of the selected round and group, or null when that group does not exist in that round. */
export function matrixRows(p: RelationshipPayload, view: RelationshipView): MatrixRow[] | null {
  const group = p.groups.find((g) => g.set_id === view.cut && sameDimensions(g.dimensions, view.values));
  if (group === undefined || view.round === null) return null;
  if (!p.summaries.some((s) => s.round === view.round && s.group.set_id === group.set_id && sameDimensions(s.group.dimensions, group.dimensions))) return null;
  return p.cells
    .filter((c) => c.round === view.round && c.group.set_id === group.set_id && sameDimensions(c.group.dimensions, group.dimensions))
    .map((cell) => ({
      key: `${cell.origin}>${cell.destination}`, origin: cell.origin, destination: cell.destination,
      stayed: cell.origin === cell.destination,
      focal: p.focal_party !== null && (cell.origin === p.focal_party || cell.destination === p.focal_party),
      cell,
    }));
}

export const groupLabel = (g: RelationshipGroup): string =>
  Object.keys(g.dimensions).length === 0 ? "All respondents" : Object.values(g.dimensions).join(" · ");

/** One row per group of the selected cut, with each round's summary; search filters on the label. */
export function summaryRows(p: RelationshipPayload, view: RelationshipView): SummaryRow[] {
  const needle = view.search.trim().toLowerCase();
  return p.groups
    .filter((g) => g.set_id === view.cut && (needle === "" || groupLabel(g).toLowerCase().includes(needle)))
    .map((group) => ({
      key: `${group.set_id}:${groupLabel(group)}`, group, label: groupLabel(group),
      byRound: Object.fromEntries(p.summaries
        .filter((s) => s.group.set_id === group.set_id && sameDimensions(s.group.dimensions, group.dimensions))
        .map((s) => [s.round, s])),
    }));
}
