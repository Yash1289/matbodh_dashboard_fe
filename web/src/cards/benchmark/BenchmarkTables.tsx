import { Text } from "@mantine/core";
import type { ReactNode } from "react";
import type { BenchmarkPayload } from "../../api/types";
import { groupedRows, type BenchmarkView, type GroupRows } from "./benchmarkRows";

export const TABLE_LABELS = {
  comparison: "Comparison", summary: "Seat summary", margin_buckets: "Margin buckets", flips: "Flips",
} as const;

const ABSENT_REASON = "not in this endpoint's mapping";
const BUCKETS: Record<string, string> = {
  winning_both: "Winning both", gain: "Gain", loss: "Loss", losing_both: "Losing both",
};

export function bucketLabel(bucket: string): string {
  if (bucket in BUCKETS) return BUCKETS[bucket];
  const m = /^(ahead|behind)_(\d+)_(\d+|plus)$/.exec(bucket);
  if (!m) return bucket;
  return `${m[1] === "ahead" ? "Ahead" : "Behind"} ${m[3] === "plus" ? `${m[2]}+` : `${m[2]}–${m[3]}`} pp`;
}

export const pct = (v: number | null) => (v === null ? null : `${v.toFixed(1)}%`);
export const pp = (v: number | null) => (v === null ? null : `${v > 0 ? "+" : ""}${v.toFixed(1)} pp`);
export const count = (v: number | null) => (v === null ? null : String(v));
export const signed = (v: number | null) => (v === null ? null : `${v > 0 ? "+" : ""}${v}`);

export const anchorLabel = (p: BenchmarkPayload) =>
  p.rounds.items.find((i) => i.obs_id === p.rounds.anchor)?.label ?? "Survey";
export const referenceLabel = (p: BenchmarkPayload) => p.reference.label ?? "Reference";

const cell = { padding: "4px 8px", textAlign: "right" as const };

/** A value, or a dash that says why (never a synthesised zero). */
function Cell({ text, absent }: { text: string | null; absent: boolean }) {
  return (
    <td style={cell}>
      {text === null ? <span title={absent ? ABSENT_REASON : "no value"}>–</span> : text}
    </td>
  );
}

function Grid<T>({ caption, heads, groups, row, search }: {
  caption: string; heads: string[]; groups: GroupRows<T>[]; row: (r: T, i: number) => ReactNode; search: string;
}) {
  if (groups.length === 0) return <Text size="sm" role="status">{`No rows match “${search.trim()}”.`}</Text>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <caption style={{ textAlign: "left", color: "var(--mb-muted)", paddingBottom: 6 }}>{caption}</caption>
      <thead>
        <tr>{heads.map((h, i) => <th key={h} scope="col" style={{ ...cell, textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr>
      </thead>
      {groups.map((g) => (
        <tbody key={g.key}>
          <tr><th scope="rowgroup" colSpan={heads.length} style={{ ...cell, textAlign: "left", paddingTop: 10 }}>{g.label}</th></tr>
          {g.rows.map(row)}
        </tbody>
      ))}
    </table>
  );
}

const Head = ({ children }: { children: ReactNode }) => <th scope="row" style={{ ...cell, textAlign: "left" }}>{children}</th>;

/** The chosen engine table, copied as the engine returned it; only ordering and labels are decided here. */
export function BenchmarkTables({ payload: p, view }: { payload: BenchmarkPayload; view: BenchmarkView }) {
  const [t, r] = [anchorLabel(p), referenceLabel(p)];
  const other = p.other_label;
  const parties = p.parties;
  const rowsOf = {
    comparison: p.comparisons, summary: p.summaries, margin_buckets: p.margin_buckets, flips: p.flips,
  }[view.table];

  if (rowsOf.length === 0) {
    return <Text size="sm">{p.reference.kind === "none" ? "No seats are covered" : "No seats are covered by both endpoints"}</Text>;
  }
  const side = (s: "target" | "reference") => (s === "target" ? t : r);

  if (view.table === "comparison") {
    const groups = groupedRows(p.comparisons, parties, other, view.search);
    return (
      <Grid search={view.search} caption={`Comparison · ${t} vs ${r}`} groups={groups}
        heads={["Party", `${t} vote share`, `${r} vote share`, "Δ vote share", `${t} seats`, `${r} seats`, "Δ seats"]}
        row={(x, i) => (
          <tr key={i}>
            <Head>{x.party}</Head>
            <Cell text={pct(x.target_vote_share)} absent={x.absent_sides.includes("target")} />
            <Cell text={pct(x.reference_vote_share)} absent={x.absent_sides.includes("reference")} />
            <Cell text={pp(x.vote_share_delta_pp)} absent={x.absent_sides.length > 0} />
            <Cell text={count(x.target_seats)} absent={x.absent_sides.includes("target")} />
            <Cell text={count(x.reference_seats)} absent={x.absent_sides.includes("reference")} />
            <Cell text={signed(x.seat_delta)} absent={x.absent_sides.length > 0} />
          </tr>
        )} />
    );
  }
  if (view.table === "summary") {
    const groups = groupedRows(p.summaries, parties, other, view.search);
    return (
      <Grid search={view.search} caption="Seat summary" groups={groups}
        heads={["Party", "Round", "Seats won", "Seat share", "Vote share", "Eligible seats"]}
        row={(x, i) => (
          <tr key={i}>
            <Head>{x.party}</Head>
            <td style={cell}>{side(x.endpoint)}</td>
            <Cell text={count(x.seats)} absent={x.absent !== null} />
            <Cell text={pct(x.seat_share)} absent={x.absent !== null} />
            <Cell text={pct(x.vote_share)} absent={x.absent !== null} />
            <td style={cell}>{x.eligible_seats}</td>
          </tr>
        )} />
    );
  }
  if (view.table === "margin_buckets") {
    const groups = groupedRows(p.margin_buckets, parties, other, view.search);
    return (
      <Grid search={view.search} caption={`Margin buckets · ${p.focal_party ?? ""}`} groups={groups}
        heads={["Margin", "Round", "Seats", "Eligible seats"]}
        row={(x, i) => (
          <tr key={i}><Head>{bucketLabel(x.bucket)}</Head><td style={cell}>{side(x.endpoint)}</td>
            <td style={cell}>{x.seats}</td><td style={cell}>{x.eligible_seats}</td></tr>
        )} />
    );
  }
  const groups = groupedRows(p.flips, parties, other, view.search);
  return (
    <Grid search={view.search} caption={`Flips · ${p.focal_party ?? ""} · ${t} vs ${r}`} groups={groups}
      heads={["Outcome", "Seats", "Eligible seats"]}
      row={(x, i) => (
        <tr key={i}><Head>{bucketLabel(x.bucket)}</Head><td style={cell}>{x.seats}</td><td style={cell}>{x.eligible_seats}</td></tr>
      )} />
  );
}
