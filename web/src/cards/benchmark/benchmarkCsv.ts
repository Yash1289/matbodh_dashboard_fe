import type { BenchmarkPayload } from "../../api/types";
import { groupedRows, groupLabel, type BenchmarkView } from "./benchmarkRows";
import { anchorLabel, bucketLabel, referenceLabel } from "./BenchmarkTables";

const field = (v: string | number | null): string => {
  const s = v === null ? "" : String(v); // a dash is an empty cell, never a 0
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (cells: (string | number | null)[]) => cells.map(field).join(",");

/** The table on screen (same search), values unchanged; a missing value is an empty cell. */
export function benchmarkToCsv(p: BenchmarkPayload, view: BenchmarkView): string {
  const [t, r] = [anchorLabel(p), referenceLabel(p)];
  const side = (s: "target" | "reference") => (s === "target" ? t : r);
  const flat = <T extends { group: Parameters<typeof groupLabel>[0] }>(rows: T[]) =>
    groupedRows(rows as (T & { party?: string })[], p.parties, p.other_label, view.search).flatMap((g) => g.rows);
  if (view.table === "comparison") {
    return [line(["Group", "Party", `${t} vote share`, `${r} vote share`, "Vote share change (pp)",
      `${t} seats`, `${r} seats`, "Seat change"]),
    ...flat(p.comparisons).map((x) => line([groupLabel(x.group), x.party, x.target_vote_share,
      x.reference_vote_share, x.vote_share_delta_pp, x.target_seats, x.reference_seats, x.seat_delta]))].join("\n");
  }
  if (view.table === "summary") {
    return [line(["Group", "Party", "Round", "Seats won", "Seat share", "Vote share", "Eligible seats"]),
      ...flat(p.summaries).map((x) => line([groupLabel(x.group), x.party, side(x.endpoint), x.seats, x.seat_share,
        x.vote_share, x.eligible_seats]))].join("\n");
  }
  if (view.table === "margin_buckets") {
    return [line(["Group", "Margin", "Round", "Seats", "Eligible seats"]),
      ...flat(p.margin_buckets).map((x) => line([groupLabel(x.group), bucketLabel(x.bucket), side(x.endpoint),
        x.seats, x.eligible_seats]))].join("\n");
  }
  return [line(["Group", "Outcome", "Seats", "Eligible seats"]),
    ...flat(p.flips).map((x) => line([groupLabel(x.group), bucketLabel(x.bucket), x.seats, x.eligible_seats]))].join("\n");
}
