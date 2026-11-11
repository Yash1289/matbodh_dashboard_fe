import type { BenchmarkGroup, BenchmarkPayload, BenchmarkSide, BenchmarkTable } from "../../api/types";

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
