import type { BenchmarkComparisonRow, BenchmarkGroup, BenchmarkPayload, BenchmarkSide, BenchmarkSummaryRow, BenchmarkTable } from "../../api/types";

/** Display state only: nothing here changes the engine run. */
export interface BenchmarkView { table: BenchmarkTable; search: string }

/** Opens on the payload's default table (the card's own choice when that table can exist). */
export const initialBenchmarkView = (p: BenchmarkPayload): BenchmarkView =>
  ({ table: p.default_table, search: "" });

export const groupLabel = (g: BenchmarkGroup): string => {
  const dims = Object.entries(g.dimensions).map(([k, v]) => `${k}: ${v}`);
  return dims.length ? dims.join(", ") : "All seats";
};

export interface GroupRows<T> { key: string; label: string; rows: T[] }

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const sideRank = (s: BenchmarkSide | undefined) => (s === "reference" ? 1 : 0);

/**
 * Groups rows by seat group (natural order: AC 1, 2, 10) and orders each group's rows: target
 * before reference, major parties in payload order, any other named party, then Other last.
 * Only reorders and filters; no value is touched.
 */
export function groupedRows<T extends { group: BenchmarkGroup; party?: string; endpoint?: BenchmarkSide }>(
  rows: T[], parties: string[], other: string, search: string,
): GroupRows<T>[] {
  const needle = search.trim().toLowerCase();
  const kept = needle === "" ? rows : rows.filter((r) =>
    groupLabel(r.group).toLowerCase().includes(needle) || (r.party ?? "").toLowerCase().includes(needle));
  const partyRank = (p: string | undefined) => (p === other ? Number.MAX_SAFE_INTEGER
    : parties.includes(p ?? "") ? parties.indexOf(p as string) : parties.length);
  const byKey = new Map<string, GroupRows<T>>();
  for (const r of kept) {
    const key = `${r.group.set_id}|${JSON.stringify(r.group.dimensions)}`;
    const entry = byKey.get(key) ?? { key, label: groupLabel(r.group), rows: [] };
    entry.rows.push(r);
    byKey.set(key, entry);
  }
  for (const g of byKey.values()) {
    g.rows.sort((a, b) => sideRank(a.endpoint) - sideRank(b.endpoint) || partyRank(a.party) - partyRank(b.party));
  }
  return [...byKey.values()].sort((a, b) => {
    const [sa, sb] = [a.key.split("|")[0], b.key.split("|")[0]];
    return natural.compare(sa, sb) || natural.compare(a.label, b.label);
  });
}

export interface SummaryCell {
  voteShare: number | null; voteDelta: number | null; seats: number | null; seatDelta: number | null; absent: boolean;
}
export interface SummaryRow { key: string; label: string; eligible: number; cells: Record<string, SummaryCell | null> }

/**
 * The Summary table: one row per seat group (All seats first), one column per party (Other last), each cell
 * merging vote share and seats with their changes. Numbers are copied from the comparison rows, or from the
 * target summary rows (no changes) when there is no reference. A party a group has no row for is null.
 */
export function summaryMatrix(p: BenchmarkPayload, search: string): { parties: string[]; rows: SummaryRow[] } {
  const parties = [...p.parties, p.other_label];
  const merged = p.comparisons.length > 0;
  const source: (BenchmarkComparisonRow | BenchmarkSummaryRow)[] = merged ? p.comparisons : p.summaries.filter((r) => r.endpoint === "target");
  const groups = groupedRows(source, p.parties, p.other_label, search);
  const rows = groups.map((g) => {
    const cells: Record<string, SummaryCell | null> = Object.fromEntries(parties.map((x) => [x, null]));
    for (const r of g.rows) {
      cells[r.party] = "target_vote_share" in r
        ? { voteShare: r.target_vote_share, voteDelta: r.vote_share_delta_pp, seats: r.target_seats, seatDelta: r.seat_delta, absent: r.absent_sides.includes("target") }
        : { voteShare: r.vote_share, voteDelta: null, seats: r.seats, seatDelta: null, absent: r.absent !== null };
    }
    return { key: g.key, label: g.label, eligible: g.rows[0]?.eligible_seats ?? 0, cells };
  });
  return { parties, rows };
}
