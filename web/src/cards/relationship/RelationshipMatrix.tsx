import { Text } from "@mantine/core";
import type { RelationshipCell, RelationshipPayload } from "../../api/types";
import { formatValue } from "../../cells/format";
import { tokens } from "../../theme";
import { tint } from "../../table/formatRules";
import { PIN, TableFrame } from "../../table/TableFrame";
import { groupLabel, matrixRows, roundLabel, type RelationshipView } from "./relationshipRows";

const cell = { textAlign: "right" as const };
const num = (v: number | null) => (v === null ? "—" : String(Math.round(v * 100) / 100));

interface Measure { head: string; text: (c: RelationshipCell) => string | null }
/** Details measures with their raw engine values (the CSV exports these). */
export interface RawMeasure { head: string; raw: (c: RelationshipCell) => number | null }

const MEASURES: Measure[] = [
  { head: "Origin share", text: (c) => formatValue(c.origin_share, "pct") },
  { head: "Destination share", text: (c) => formatValue(c.destination_share, "pct") },
  { head: "Joint share", text: (c) => formatValue(c.joint_share, "pct") },
  { head: "Size of impact (pp)", text: (c) => formatValue(c.size_of_impact_pp, "pp") },
];
export const DETAIL_RAW: RawMeasure[] = [
  { head: "Respondents", raw: (c) => c.joint_count },
  { head: "Origin base", raw: (c) => c.origin_base },
  { head: "Destination base", raw: (c) => c.destination_base },
  { head: "Paired base", raw: (c) => c.paired_base },
  { head: "Paired respondents", raw: (c) => c.paired_count },
];
const DETAILS: Measure[] = [
  { head: "Respondents", text: (c) => (c.joint_count === null ? "—" : String(c.joint_count)) },
  { head: "Origin base", text: (c) => num(c.origin_base) },
  { head: "Destination base", text: (c) => num(c.destination_base) },
  { head: "Paired base", text: (c) => num(c.paired_base) },
  { head: "Paired respondents", text: (c) => (c.paired_count === null ? "—" : String(c.paired_count)) },
];

interface Props { payload: RelationshipPayload; view: RelationshipView }

/** Origin-to-destination pairs of the major parties for one round and one group; the engine's numbers only. */
export function RelationshipMatrixTable({ payload, view }: Props) {
  if (payload.groups.length === 0) return <Text size="sm" role="status">The engine returned no relationship rows.</Text>;
  const rows = matrixRows(payload, view);
  if (rows === null) return <Text size="sm" role="status">No such group in this round</Text>;
  const measures = view.showDetails ? [...MEASURES, ...DETAILS] : MEASURES;
  const group = payload.groups.find((g) => g.set_id === view.cut && Object.entries(view.values).every(([k, v]) => g.dimensions[k] === v));
  const reason = (stayed: boolean) => (stayed ? "no respondents stayed" : "no respondents moved");
  return (
    <div>
    <TableFrame minWidthEm={14 + 9 * measures.length}>
    <table>
      <caption style={{ textAlign: "left", color: "var(--mb-muted)", padding: "8px 12px" }}>
        Matrix · {view.round === null ? "" : roundLabel(payload, view.round)}{group ? ` · ${groupLabel(group)}` : ""}
        {" · "}{payload.origin} → {payload.destination}
      </caption>
      <thead>
        <tr>
          <th scope="col" className={PIN}>Origin → destination</th>
          {measures.map((m) => <th key={m.head} scope="col" style={cell}>{m.head}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} {...(r.focal ? { "data-focal": "" } : {})} {...(r.stayed ? { "data-diagonal": "" } : {})} style={r.focal ? { fontWeight: 600 } : undefined}>
            <th scope="row" className={PIN} style={{ fontWeight: "inherit" }}>
              {r.origin} → {r.destination}{r.stayed && <> <small style={{ color: "var(--mb-muted)" }}>stayed</small></>}
            </th>
            {measures.map((m) => {
              // The origin share is the matrix's headline: a soft wash that grows with the share (never the browser's own arithmetic).
              const share = m.head === "Origin share" && r.cell.absent === null ? r.cell.origin_share : null;
              return (
                <td key={m.head} style={{ ...cell, ...(share !== null ? { background: tint("primary", share / 100) } : {}) }}
                  {...(share !== null ? { "data-share": "" } : {})}>
                  {r.cell.absent !== null ? <span title={reason(r.stayed)} aria-label={reason(r.stayed)}>—</span> : m.text(r.cell)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
    </TableFrame>
    {rows.some((r) => r.cell.absent !== null) && (
      <Text fz={tokens.font.subtitle} c="var(--mb-muted)" mt={4}>— means no respondents moved (or stayed, on the diagonal) between these parties</Text>
    )}
    </div>
  );
}
