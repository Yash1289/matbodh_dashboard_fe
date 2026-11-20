import { Text } from "@mantine/core";
import type { ReactNode } from "react";
import type { BenchmarkBucketRow, BenchmarkFlipRow, BenchmarkPayload } from "../../api/types";
import { PIN, TableFrame } from "../../table/TableFrame";
import styles from "./Benchmark.module.css";
import { groupedRows, summaryMatrix, type BenchmarkView, type GroupRows, type SummaryCell } from "./benchmarkRows";

export const TABLE_LABELS = {
  comparison: "Comparison", summary: "Summary", margin_buckets: "Margin buckets", flips: "Seat flips",
} as const;

const ABSENT_REASON = "not in this endpoint's mapping";
const BUCKETS: Record<string, string> = {
  winning_both: "Winning both", gain: "Gain", loss: "Loss", losing_both: "Losing both",
};
// Margin rows run from far ahead to far behind; flip classes from best to worst.
const MARGIN_ORDER = ["ahead_10_plus", "ahead_5_10", "ahead_0_5", "behind_0_5", "behind_5_10", "behind_10_plus"];
const FLIP_ORDER = ["winning_both", "gain", "loss", "losing_both"];

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

const flipText = (bucket: string, t: string, r: string): string =>
  bucket === "winning_both" ? `Won in ${r} and in ${t}`
    : bucket === "gain" ? `Not won in ${r}, won in ${t}`
      : bucket === "loss" ? `Won in ${r}, not won in ${t}`
        : bucket === "losing_both" ? "Not won in either" : "";

const tone = (v: number | null): "gain" | "loss" | "neutral" => (v === null || v === 0 ? "neutral" : v > 0 ? "gain" : "loss");
const arrow = (v: number): string => (v > 0 ? "▲" : v < 0 ? "▼" : "");

/** A value, or a dash that says why (never a synthesised zero). */
function Cell({ text, absent, className, delta }: { text: string | null; absent: boolean; className?: string; delta?: number | null }) {
  return (
    <td className={[styles.num, className].filter(Boolean).join(" ")} data-tone={delta === undefined ? undefined : tone(delta)}>
      {text === null ? <span title={absent ? ABSENT_REASON : "no value"}>–</span> : text}
    </td>
  );
}

const GroupHeader = ({ colSpan, children }: { colSpan: number; children: ReactNode }) => (
  <tr><th scope="rowgroup" colSpan={colSpan} style={{ textAlign: "left", background: "var(--mb-header-bg)" }}>{children}</th></tr>
);

const Head = ({ children, pin = false }: { children: ReactNode; pin?: boolean }) =>
  <th scope="row" className={pin ? PIN : undefined}>{children}</th>;

const NoMatch = ({ search }: { search: string }) => <Text size="sm" role="status">{`No rows match “${search.trim()}”.`}</Text>;

/** One party's cell in the Summary: vote share with its change, then seats with theirs. */
function SummaryBox({ cell }: { cell: SummaryCell | null }) {
  if (cell === null) return <td className={styles.muted} title="no row for this group">–</td>;
  if (cell.voteShare === null && cell.seats === null) return <td><span title={cell.absent ? ABSENT_REASON : "no value"}>–</span></td>;
  const v = cell.voteDelta;
  const s = cell.seatDelta;
  return (
    <td>
      <div className={styles.line}>
        <span className={styles.big}>{pct(cell.voteShare) ?? "–"}</span>
        {v !== null && <span className={styles.delta} data-tone={tone(v)}>{arrow(v)} {Math.abs(v).toFixed(1)} pp</span>}
      </div>
      <div className={`${styles.line} ${styles.seats}`}>
        <b>{cell.seats ?? "–"}</b>
        {s !== null && <span className={styles.delta} data-tone={tone(s)}>{arrow(s)} {Math.abs(s)}</span>}
        <span>seats</span>
      </div>
    </td>
  );
}

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

  if (view.table === "summary") {
    const m = summaryMatrix(p, view.search);
    if (m.rows.length === 0) return <NoMatch search={view.search} />;
    return (
      <TableFrame minWidthEm={38}>
        <table>
          <caption style={{ textAlign: "left", color: "var(--mb-muted)", padding: "8px 12px" }}>Summary</caption>
          <thead>
            <tr><th scope="col" className={PIN}>Seat group</th>{m.parties.map((x) => <th key={x} scope="col">{x}</th>)}</tr>
          </thead>
          <tbody>
            {m.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className={PIN}>{row.label}<small className={styles.sub}>{row.eligible} seats</small></th>
                {m.parties.map((x) => <SummaryBox key={x} cell={row.cells[x]} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    );
  }

  if (view.table === "comparison") {
    const groups = groupedRows(p.comparisons, parties, other, view.search);
    if (groups.length === 0) return <NoMatch search={view.search} />;
    return (
      <TableFrame minWidthEm={46}>
        <table>
          <caption style={{ textAlign: "left", color: "var(--mb-muted)", padding: "8px 12px" }}>{`Comparison · ${t} vs ${r}`}</caption>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className={PIN}>Party</th>
              <th scope="colgroup" colSpan={3} className={styles.group}>Vote share</th>
              <th scope="colgroup" colSpan={4} className={`${styles.group} ${styles.vl}`}>Seats won</th>
            </tr>
            <tr>
              <th scope="col" className={styles.num}>{t}</th>
              <th scope="col" className={styles.num}>{r}</th>
              <th scope="col" className={styles.num}>Change</th>
              <th scope="col" className={`${styles.num} ${styles.vl}`}>{t}</th>
              <th scope="col" className={styles.num}>{r}</th>
              <th scope="col" className={styles.num}>Change</th>
              <th scope="col" className={styles.num}>Seat share change</th>
            </tr>
          </thead>
          {groups.map((g: GroupRows<(typeof p.comparisons)[number]>) => (
            <tbody key={g.key}>
              <GroupHeader colSpan={8}>{g.label}</GroupHeader>
              {g.rows.map((x, i) => (
                <tr key={i}>
                  <Head pin>{x.party}</Head>
                  <Cell text={pct(x.target_vote_share)} absent={x.absent_sides.includes("target")} />
                  <Cell text={pct(x.reference_vote_share)} absent={x.absent_sides.includes("reference")} />
                  <Cell text={pp(x.vote_share_delta_pp)} absent={x.absent_sides.length > 0} delta={x.vote_share_delta_pp} />
                  <Cell text={count(x.target_seats)} absent={x.absent_sides.includes("target")} className={styles.vl} />
                  <Cell text={count(x.reference_seats)} absent={x.absent_sides.includes("reference")} />
                  <Cell text={signed(x.seat_delta)} absent={x.absent_sides.length > 0} delta={x.seat_delta} />
                  <Cell text={pp(x.seat_share_delta_pp)} absent={x.absent_sides.length > 0} delta={x.seat_share_delta_pp} />
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </TableFrame>
    );
  }

  const bucketRows: (BenchmarkBucketRow | BenchmarkFlipRow)[] = view.table === "margin_buckets" ? p.margin_buckets : p.flips;
  const groups = groupedRows(bucketRows, parties, other, view.search);
  if (groups.length === 0) return <NoMatch search={view.search} />;

  if (view.table === "margin_buckets") {
    const sides = new Set(p.margin_buckets.map((x) => x.endpoint));
    const showReference = sides.has("reference");
    const widest = Math.max(1, ...p.margin_buckets.map((x) => x.seats));
    return (
      <TableFrame minWidthEm={showReference ? 34 : 24}>
        <table>
          <caption style={{ textAlign: "left", color: "var(--mb-muted)", padding: "8px 12px" }}>{`Margin buckets · ${p.focal_party ?? ""}`}</caption>
          <thead>
            <tr>
              <th scope="col" className={PIN}>{`${p.focal_party ?? "Focal party"}'s margin`}</th>
              {showReference && <th scope="col">{r}</th>}
              <th scope="col">{t}</th>
            </tr>
          </thead>
          {groups.map((g) => {
            const own = p.margin_buckets.filter((x) => `${x.group.set_id}|${JSON.stringify(x.group.dimensions)}` === g.key);
            const at = (bucket: string, side: "target" | "reference") => own.find((x) => x.bucket === bucket && x.endpoint === side);
            // Each side reports its own eligible seats; a reference can cover fewer seats than the survey.
            const eligibleOf = (side: "target" | "reference") => own.find((x) => x.endpoint === side)?.eligible_seats ?? own[0]?.eligible_seats ?? 0;
            const bars = (bucket: string, side: "target" | "reference") => {
              const x = at(bucket, side);
              if (x === undefined) return <td>–</td>;
              return (
                <td>
                  <div className={styles.mb}>
                    <b>{x.seats}</b>
                    <i className={styles.bar} data-side={bucket.startsWith("ahead") ? "ahead" : "behind"} style={{ width: `${(x.seats / widest) * 8}em` }} />
                  </div>
                </td>
              );
            };
            return (
              <tbody key={g.key}>
                <GroupHeader colSpan={showReference ? 3 : 2}>{g.label}</GroupHeader>
                {MARGIN_ORDER.filter((b) => at(b, "target") !== undefined || at(b, "reference") !== undefined).map((b) => (
                  <tr key={b}>
                    <Head pin>{bucketLabel(b)}</Head>
                    {showReference && bars(b, "reference")}
                    {bars(b, "target")}
                  </tr>
                ))}
                <tr>
                  <Head pin>All eligible seats</Head>
                  {showReference && <td className={styles.big}>{eligibleOf("reference")}</td>}
                  <td className={styles.big}>{eligibleOf("target")}</td>
                </tr>
              </tbody>
            );
          })}
        </table>
      </TableFrame>
    );
  }

  return (
    <TableFrame minWidthEm={26}>
      <table>
        <caption style={{ textAlign: "left", color: "var(--mb-muted)", padding: "8px 12px" }}>{`Flips · ${p.focal_party ?? ""} · ${t} vs ${r}`}</caption>
        <thead>
          <tr><th scope="col" className={PIN}>Outcome</th><th scope="col" className={styles.num}>Seats</th><th scope="col" className={styles.num}>Eligible seats</th></tr>
        </thead>
        {groups.map((g) => {
          const own = p.flips.filter((x) => `${x.group.set_id}|${JSON.stringify(x.group.dimensions)}` === g.key)
            .sort((a, b) => FLIP_ORDER.indexOf(a.bucket) - FLIP_ORDER.indexOf(b.bucket));
          const eligible = own[0]?.eligible_seats ?? 0;
          const label = `${g.label}: ${own.map((x) => `${bucketLabel(x.bucket)} ${x.seats}`).join(", ")} of ${eligible} seats`;
          return (
            <tbody key={g.key}>
              <GroupHeader colSpan={3}>{g.label}</GroupHeader>
              <tr>
                <td colSpan={3}>
                  <div className={styles.stack} role="img" aria-label={label}>
                    {own.map((x) => <div key={x.bucket} data-bucket={x.bucket} style={{ flex: x.seats }} title={`${bucketLabel(x.bucket)}: ${x.seats}`}>{x.seats > eligible * 0.1 ? x.seats : ""}</div>)}
                  </div>
                </td>
              </tr>
              {own.map((x) => (
                <tr key={x.bucket}>
                  <th scope="row" className={PIN}>
                    <i className={styles.swatch} data-bucket={x.bucket} />{bucketLabel(x.bucket)}
                    <small className={styles.sub}>{flipText(x.bucket, t, r)}</small>
                  </th>
                  <td className={styles.num} style={{ fontWeight: 600 }}>{x.seats}</td>
                  <td className={`${styles.num} ${styles.muted}`}>{x.eligible_seats}</td>
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </TableFrame>
  );
}
