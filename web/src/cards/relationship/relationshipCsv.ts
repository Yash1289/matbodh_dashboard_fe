import type { RelationshipPayload } from "../../api/types";
import { DETAIL_RAW } from "./RelationshipMatrix";
import { detailColumns, mainColumns } from "./RelationshipSummary";
import { groupLabel, matrixRows, roundLabel, roundsWithData, summaryRows, type RelationshipView } from "./relationshipRows";

const field = (v: string | number | null): string => {
  const s = v === null ? "" : String(v); // a dash is an empty cell, never a 0
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (cells: (string | number | null)[]) => cells.map(field).join(",");

/** The table on screen (same selection and search), engine values unformatted. */
export function relationshipToCsv(p: RelationshipPayload, view: RelationshipView): string {
  if (view.table === "matrix") {
    const rows = matrixRows(p, view) ?? [];
    const group = rows[0]?.cell.group;
    const label = group === undefined ? "" : groupLabel(group);
    const round = view.round === null ? "" : roundLabel(p, view.round);
    const extra = view.showDetails ? DETAIL_RAW : [];
    return [line(["Group", "Round", "Origin", "Destination", "Stayed", "Origin share", "Destination share",
      "Joint share", "Size of impact", "Absent", ...extra.map((m) => m.head)]),
    ...rows.map((r) => line([label, round, r.origin, r.destination, r.stayed ? "yes" : "no", r.cell.origin_share,
      r.cell.destination_share, r.cell.joint_share, r.cell.size_of_impact_pp,
      r.cell.absent === null ? "" : "no respondents moved", ...extra.map((m) => m.raw(r.cell))]))].join("\n");
  }
  const columns = [...mainColumns(p.focal_party), ...(view.showDetails ? detailColumns(p.focal_party) : [])];
  const head = columns.map((c) => c.head);
  const rows = summaryRows(p, view).flatMap((row) => roundsWithData(p).map((r) => ({ row, r, s: row.byRound[r] })));
  return [line(["Group", "Round", ...head]),
    ...rows.map(({ row, r, s }) => line([row.label, roundLabel(p, r), ...columns.map((c) => (s === undefined ? null : c.value(s)))]))].join("\n");
}
