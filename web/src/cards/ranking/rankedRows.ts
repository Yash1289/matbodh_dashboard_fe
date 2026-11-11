import type { AbsentReason, Density, RankedEntity, RankedGroup, RankedPayload } from "../../api/types";

/** One round's cell for a row: the engine's rank and value, or why there is none. */
export type RankedSlot =
  | { kind: "ranked"; round: string; rank: number | null; value: number | null; status: string; flags: string[] }
  | { kind: "absent"; round: string; reason: AbsentReason };

export interface RankedRowModel { key: string; entity: RankedEntity; group: RankedGroup; slots: RankedSlot[] }
export interface RankedSort { round: string; by: "rank" | "value"; dir: "asc" | "desc" }
/** Display state of one ranking card. Changing any of it is in-memory: it never starts a request. */
export interface RankedView { sort: RankedSort | null; search: string; density: Density; showDetails: boolean }

export const initialRankedView = (_payload: RankedPayload): RankedView =>
  ({ sort: null, search: "", density: "standard", showDetails: false });

const at = (group: string, entity: string, round: string) => `${group}\u0000${entity}\u0000${round}`;

/**
 * Rows per partition in the payload's order (anchor rank, then engine order), or sorted in memory
 * by one round's rank or value. Every number is copied from the payload; nothing is computed.
 */
export function rankedRows(p: RankedPayload, view: RankedView): { groups: { group: RankedGroup; rows: RankedRowModel[] }[]; rounds: string[] } {
  const present = new Set([...p.ranks.map((r) => r.round), ...p.absent.map((a) => a.round)]);
  const rounds = p.rounds.items.map((i) => i.obs_id).filter((o) => present.has(o));
  const entities = new Map(p.entities.map((e) => [e.key, e]));
  const ranked = new Map(p.ranks.map((r) => [at(r.group, r.entity, r.round), r]));
  const absent = new Map(p.absent.map((a) => [at(a.group, a.entity, a.round), a]));
  const needle = view.search.trim().toLowerCase();
  const matches = (e: RankedEntity) =>
    needle === "" || Object.values(e.labels).some((v) => v !== null && v.toLowerCase().includes(needle));

  const slotOf = (group: string, entity: string, round: string): RankedSlot => {
    const r = ranked.get(at(group, entity, round));
    if (r !== undefined) return { kind: "ranked", round, rank: r.rank, value: r.value, status: r.status, flags: r.flags };
    return { kind: "absent", round, reason: absent.get(at(group, entity, round))?.reason ?? "not_ranked" };
  };
  const sortValue = (row: RankedRowModel, s: RankedSort): number | null => {
    const slot = row.slots.find((x) => x.round === s.round);
    return slot?.kind === "ranked" ? slot[s.by === "rank" ? "rank" : "value"] : null;
  };

  const groups = p.groups.map((group) => {
    let rows: RankedRowModel[] = group.entities.flatMap((key) => {
      const entity = entities.get(key);
      return entity !== undefined && matches(entity)
        ? [{ key: `${group.key}::${key}`, entity, group, slots: rounds.map((r) => slotOf(group.key, key, r)) }]
        : [];
    });
    const s = view.sort;
    if (s !== null) {
      const sign = s.dir === "asc" ? 1 : -1;
      rows = rows.map((row, i) => ({ row, i, v: sortValue(row, s) }))
        .sort((a, b) => (a.v === null ? (b.v === null ? a.i - b.i : 1) : b.v === null ? -1 : sign * (a.v - b.v) || a.i - b.i))
        .map((x) => x.row);
    }
    return { group, rows };
  }).filter((g) => g.rows.length > 0);
  return { groups, rounds };
}

/** Keys of rows that share a rank with another row of the same partition in the anchor round. */
export function tieKeys(rows: RankedRowModel[], anchorRound: string): Set<string> {
  const seen = new Map<string, string[]>();
  for (const row of rows) {
    const slot = row.slots.find((s) => s.round === anchorRound);
    if (slot?.kind !== "ranked" || slot.rank === null) continue;
    const id = `${row.group.key}\u0000${slot.rank}`;
    seen.set(id, [...(seen.get(id) ?? []), row.key]);
  }
  return new Set([...seen.values()].filter((keys) => keys.length > 1).flat());
}
