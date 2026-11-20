import { Text } from "@mantine/core";
import { Fragment } from "react";
import type { RelationshipPayload, RelationshipSummary } from "../../api/types";
import { formatValue } from "../../cells/format";
import { PIN, TableFrame } from "../../table/TableFrame";
import { roundLabel, roundsWithData, summaryRows, type RelationshipView } from "./relationshipRows";

type Unit = "pct" | "pp";
interface Column {
  head: string;
  tip: string;
  unit: Unit | "base" | "count";
  value: (s: RelationshipSummary) => number | null;
}

const cell = { textAlign: "right" as const };
const num = (v: number | null) => (v === null ? "—" : String(Math.round(v * 100) / 100));

/** Main columns: with a focal party the five readout measures, otherwise agreement alone. */
export const mainColumns = (focal: string | null): Column[] => focal === null
  ? [{ head: "Agreement share", tip: "Respondents with the same party at both questions, as a share of those who answered both", unit: "pct", value: (s) => s.agreement_share }]
  : [
    { head: "Net flow (pp)", tip: `${focal} gained minus lost, as a share of all respondents who answered both questions (percentage points)`, unit: "pp", value: (s) => s.net_flow_pp },
    { head: "Retention share", tip: `Of those who were ${focal} before, the share who still are`, unit: "pct", value: (s) => s.retention_share },
    { head: "Gained population share", tip: `Respondents who moved to ${focal}, as a share of all who answered both questions`, unit: "pct", value: (s) => s.gained_population_share },
    { head: "Lost population share", tip: `Respondents who left ${focal}, as a share of all who answered both questions`, unit: "pct", value: (s) => s.lost_population_share },
    { head: "Acquisition share", tip: `Of those who are ${focal} now, the share who were not before`, unit: "pct", value: (s) => s.acquisition_share },
  ];

export const detailColumns = (focal: string | null): Column[] => [
  ...(focal === null ? [] : [
    { head: "Agreement share", tip: "Same party at both questions, of those who answered both", unit: "pct", value: (s: RelationshipSummary) => s.agreement_share },
    { head: "Loss share", tip: `Of those who were ${focal} before, the share who left`, unit: "pct", value: (s: RelationshipSummary) => s.loss_share },
    { head: "Conversion share", tip: `Of those who were not ${focal} before, the share who moved to it`, unit: "pct", value: (s: RelationshipSummary) => s.conversion_share },
    { head: "Neither population share", tip: `Respondents who were not ${focal} at either question, of all who answered both`, unit: "pct", value: (s: RelationshipSummary) => s.neither_population_share },
  ] as Column[]),
  { head: "Composition share", tip: "This group's share of the population", unit: "pct", value: (s) => s.composition_share },
  ...(focal === null ? [] : [
    { head: "Focal origin base", tip: "Weighted mass of respondents who were the focal party before", unit: "base", value: (s: RelationshipSummary) => s.focal_origin_base },
    { head: "Focal destination base", tip: "Weighted mass of respondents who are the focal party now", unit: "base", value: (s: RelationshipSummary) => s.focal_destination_base },
  ] as Column[]),
  { head: "Paired base", tip: "Weighted mass of respondents who answered both questions", unit: "base", value: (s) => s.paired_base },
  { head: "Respondents", tip: "Respondents who answered both questions", unit: "count", value: (s) => s.paired_count },
];

const show = (v: number | null, unit: Column["unit"]) =>
  unit === "pct" || unit === "pp" ? formatValue(v, unit) : unit === "count" ? (v === null ? "—" : String(v)) : num(v);

interface Props { payload: RelationshipPayload; view: RelationshipView }

/** One row per group value; each cell shows the rounds as pipes (values side by side, never deltas). */
export function RelationshipSummaryTable({ payload, view }: Props) {
  if (payload.groups.length === 0) return <Text size="sm" role="status">The engine returned no relationship rows.</Text>;
  const rows = summaryRows(payload, view);
  if (rows.length === 0) return <Text size="sm" role="status">{`No groups match “${view.search.trim()}”.`}</Text>;
  const rounds = roundsWithData(payload);
  const columns = [...mainColumns(payload.focal_party), ...(view.showDetails ? detailColumns(payload.focal_party) : [])];
  return (
    <TableFrame minWidthEm={14 + 9 * columns.length}>
    <table>
      <caption style={{ textAlign: "left", color: "var(--mb-muted)", padding: "8px 12px" }}>
        Flow summary · {payload.origin} → {payload.destination}
        {payload.focal_party !== null && ` · focal ${payload.focal_party}`}
      </caption>
      <thead>
        <tr>
          <th scope="col" className={PIN}>Group</th>
          {columns.map((c) => <th key={c.head} scope="col" title={c.tip} style={cell}>{c.head}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row" className={PIN}>{row.label}</th>
            {columns.map((c) => (
              <td key={c.head} style={cell}>
                <div role="group" style={{ display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: 8 }}>
                  {rounds.map((round, i) => {
                    const s = row.byRound[round];
                    const text = s === undefined ? "—" : show(c.value(s), c.unit);
                    return (
                      <Fragment key={round}>
                        {i > 0 && <span aria-hidden style={{ alignSelf: "stretch", width: 1, background: "var(--mb-border)" }} />}
                        <span data-segment aria-label={`${roundLabel(payload, round)}: ${text}`}>{text}</span>
                      </Fragment>
                    );
                  })}
                </div>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </TableFrame>
  );
}
