import type { RelationshipPayload } from "../../api/types";
import { matrixRows, roundLabel, roundsWithData, summaryRows, type RelationshipView } from "./relationshipRows";

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
    const label = group === undefined ? "" : Object.values(group.dimensions).join(" · ") || "All respondents";
    const round = view.round === null ? "" : roundLabel(p, view.round);
    return [line(["Group", "Round", "Origin", "Destination", "Stayed", "Origin share", "Destination share",
      "Joint share", "Size of impact (pp)", "Absent"]),
    ...rows.map((r) => line([label, round, r.origin, r.destination, r.stayed ? "yes" : "no", r.cell.origin_share,
      r.cell.destination_share, r.cell.joint_share, r.cell.size_of_impact_pp,
      r.cell.absent === null ? "" : "no respondents moved"]))].join("\n");
  }
  const focal = p.focal_party !== null;
  const head = focal
    ? ["Net flow (pp)", "Retention share", "Gained population share", "Lost population share", "Acquisition share"]
    : ["Agreement share"];
  const rows = summaryRows(p, view).flatMap((row) => roundsWithData(p).map((r) => ({ row, r, s: row.byRound[r] })));
  return [line(["Group", "Round", ...head]),
    ...rows.map(({ row, r, s }) => line([row.label, roundLabel(p, r), ...(s === undefined ? head.map(() => null) : focal
      ? [s.net_flow_pp, s.retention_share, s.gained_population_share, s.lost_population_share, s.acquisition_share]
      : [s.agreement_share])]))].join("\n");
}
