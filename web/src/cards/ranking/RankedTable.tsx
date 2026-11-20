import { Button, Group, Text } from "@mantine/core";
import { useMemo, useState } from "react";
import type { AbsentReason, RankedPayload, Unit } from "../../api/types";
import { formatValue } from "../../cells/format";
import { PIN, TableFrame } from "../../table/TableFrame";
import { chipProps } from "../PopoverChip";
import styles from "./Ranked.module.css";
import { movement, rankedRows, tieKeys, type Movement, type RankedSlot, type RankedView } from "./rankedRows";

const ROW_LIMIT = 100;
const PADDING = { compact: 2, standard: 5, detailed: 9 } as const;

const unitOf = (p: RankedPayload): Unit => (p.unit === "percentage_points" ? "pp" : "pct");

const reasonText = (reason: AbsentReason, label: string, topK: number | null): string =>
  reason === "outside_top_k" ? `outside top ${topK ?? "k"} in ${label}`
    : reason === "not_ranked" ? `not ranked in ${label}`
      : `calculation failed in ${label}`;

const ABSENT_SHORT: Record<AbsentReason, string> = { outside_top_k: "Outside top", not_ranked: "Not ranked", round_failed: "Failed" };

const MOVE_TEXT = (m: Movement): string =>
  m.kind === "up" ? `▲ ${m.by}` : m.kind === "down" ? `▼ ${m.by}` : m.kind === "same" ? "=" : "new";

/** `ac_num: 12` reads "AC 12"; other dimensions keep their value with a spaced name. */
const partitionText = (name: string, value: string | null): string =>
  name.endsWith("_num") ? `${name.slice(0, -4).toUpperCase()} ${value ?? "—"}` : `${name.replace(/_/g, " ")}: ${value ?? "—"}`;

interface Props { payload: RankedPayload; view: RankedView }

/** Ranked rows grouped by partition; every number is the engine's, absent slots say why. */
export function RankedTable({ payload, view }: Props) {
  const model = useMemo(() => rankedRows(payload, view), [payload, view]);
  const [shown, setShown] = useState(ROW_LIMIT);
  // Display state only: which partition groups are folded away.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) => setClosed((c) => { const n = new Set(c); if (!n.delete(key)) n.add(key); return n; });
  const unit = unitOf(payload);
  const labelOf = (obs: string) => payload.rounds.items.find((i) => i.obs_id === obs)?.label ?? obs;
  const all = useMemo(() => model.groups.flatMap((g) => g.rows), [model]);
  // Ties are a property of the ranking, not of the rows a search leaves visible.
  const ties = useMemo(
    () => tieKeys(rankedRows(payload, { ...view, search: "" }).groups.flatMap((g) => g.rows), payload.rounds.anchor),
    [payload, view],
  );
  const bases = useMemo(
    () => new Map(payload.ranks.map((r) => [`${r.group}\u0000${r.entity}\u0000${r.round}`, r.unweighted_base ?? r.target_base])),
    [payload.ranks],
  );
  const cellPad = { paddingBlock: PADDING[view.density] };
  const partitioned = payload.partition_by.length > 0;
  const seat = payload.entity_kind === "seat";
  const trend = model.rounds.length > 1;
  const columns = trend ? 1 + model.rounds.length : 3;
  // The bar of a single-round ranking is proportional to the largest value on the card.
  const widest = useMemo(
    () => Math.max(0, ...all.flatMap((r) => r.slots.flatMap((s) => (s.kind === "ranked" && s.value !== null ? [Math.abs(s.value)] : [])))),
    [all],
  );

  const rankText = (row: { key: string }, slot: RankedSlot) => {
    if (slot.kind === "absent") {
      const why = reasonText(slot.reason, labelOf(slot.round), payload.top_k);
      return { shown: "—", label: `${labelOf(slot.round)}: ${why}`, title: why };
    }
    const tied = slot.round === payload.rounds.anchor && ties.has(row.key);
    return { shown: slot.rank === null ? "—" : `${tied ? "=" : ""}${slot.rank}`,
      label: `${labelOf(slot.round)}: rank ${slot.rank ?? "unavailable"}${tied ? " (tied)" : ""}`,
      title: tied ? "Tied with another row" : undefined };
  };

  const badge = (row: { key: string }, slot: RankedSlot) => {
    const t = rankText(row, slot);
    if (slot.kind === "absent") return <span className={styles.na} aria-label={t.label} title={t.title}>{ABSENT_SHORT[slot.reason]}</span>;
    return <span className={styles.rank} data-rank data-top={slot.rank !== null && slot.rank <= 3} aria-label={t.label} title={t.title}>{t.shown}</span>;
  };

  const valueOf = (group: string, entity: string, slot: RankedSlot) => {
    if (slot.kind === "absent") return null;
    const text = formatValue(slot.value, unit);
    const base = view.showDetails ? bases.get(`${group}\u0000${entity}\u0000${slot.round}`) : undefined;
    return { shown: base === undefined || base === null ? text : `${text} (base ${Math.round(base * 100) / 100})`,
      label: `${labelOf(slot.round)}: ${text}`,
      title: slot.value === null ? `no value (${slot.status})` : undefined };
  };

  let remaining = shown;
  const body = model.groups.flatMap(({ group, rows }) => {
    const visible = rows.slice(0, Math.max(remaining, 0));
    remaining -= visible.length;
    if (visible.length === 0) return [];
    const eligible = view.showDetails ? Object.values(group.eligible_count).find((n) => n !== null) : undefined;
    const open = !closed.has(group.key);
    const header = partitioned && (
      <tr key={`g:${group.key}`}>
        <th colSpan={columns} scope="rowgroup" style={{ background: "var(--mb-header-bg)", padding: 0 }}>
          <button type="button" aria-expanded={open} onClick={() => toggle(group.key)} className={chipProps(false).className}
            style={{ background: "none", border: 0, font: "inherit", color: "inherit", textAlign: "left", boxSizing: "border-box", display: "flex", width: "100%", gap: 8, padding: "0.6em 1.1em", fontWeight: 600 }}>
            <span aria-hidden style={{ transition: "transform .2s", transform: open ? "none" : "rotate(-90deg)" }}>▾</span>
            <span>
              {Object.entries(group.partition).map(([k, v]) => partitionText(k, v)).join(" · ")}
              {eligible !== undefined && ` · ${eligible} ranked`}
            </span>
          </button>
        </th>
      </tr>
    );
    const rowsOut = visible.map((row) => {
      const labels = row.entity.labels;
      const name = seat ? (
        <>
          {labels.name !== undefined && <strong>{labels.name} </strong>}
          <small style={{ color: "var(--mb-muted)" }}>{payload.level.toUpperCase()} {labels.seat_id}</small>
        </>
      ) : labels[payload.level];
      if (!trend) {
        const slot = row.slots[0];
        const v = slot === undefined ? null : valueOf(row.group.key, row.entity.key, slot);
        const pct = slot?.kind === "ranked" && slot.value !== null && widest > 0 ? Math.round((Math.abs(slot.value) / widest) * 100) : null;
        return (
          <tr key={row.key}>
            <td style={cellPad}>{slot !== undefined && badge(row, slot)}</td>
            <th scope="row" style={cellPad}>{name}</th>
            <td style={cellPad}>
              {slot?.kind === "absent" ? null : (
                <div className={styles.barRow}>
                  <span className={styles.barTrack}>{pct !== null && <i className={styles.bar} data-bar style={{ width: `${pct}%` }} />}</span>
                  <span className={styles.value} aria-label={v?.label} title={v?.title}>{v?.shown ?? "—"}</span>
                </div>
              )}
            </td>
          </tr>
        );
      }
      return (
        <tr key={row.key}>
          <th scope="row" className={PIN} style={cellPad}>{name}</th>
          {row.slots.map((slot, i) => {
            const v = valueOf(row.group.key, row.entity.key, slot);
            const prev = i === 0 ? undefined : row.slots[i - 1];
            const move = i === 0 || slot.kind === "absent"
              ? movement(undefined, undefined)
              : movement(
                // A round that failed to calculate says nothing about whether the seat was ranked, so it is not "new".
                prev?.kind === "absent" && prev.reason === "round_failed" ? undefined : prev?.kind === "ranked" ? prev.rank : null,
                slot.rank);
            return (
              <td key={slot.round} style={cellPad}>
                <div className={styles.cell}>
                  {badge(row, slot)}
                  {v !== null && <span className={styles.value} aria-label={v.label} title={v.title}>{v.shown}</span>}
                  {move.kind !== "none" && <span className={styles.move} data-movement={move.kind}>{MOVE_TEXT(move)}</span>}
                </div>
              </td>
            );
          })}
        </tr>
      );
    });
    return [<tbody key={group.key}>{header}{partitioned && !open ? null : rowsOut}</tbody>];
  });

  if (model.groups.length === 0) {
    const needle = view.search.trim();
    return <Text size="sm" role="status">{needle === "" ? "The engine returned no ranked rows." : `No rows match “${needle}”.`}</Text>;
  }

  const level = seat ? payload.level.toUpperCase() : payload.level;
  return (
    <div>
      <TableFrame minWidthEm={trend ? 8 + 11 * model.rounds.length : undefined}>
        <table>
          <caption style={{ textAlign: "left", color: "var(--mb-muted)", padding: "8px 12px" }}>
            {unit === "pp" ? "Percentage points" : "Percentage"} · ranked {payload.direction === "ASC" ? "lowest" : "highest"} first
            {payload.top_k !== null && ` · top ${payload.top_k} per ${partitioned ? "partition" : "ranking"}`}
          </caption>
          <thead>
            <tr>
              {trend ? (
                <>
                  <th scope="col" className={PIN}>{level}</th>
                  {model.rounds.map((r) => <th key={r} scope="col">{labelOf(r)}</th>)}
                </>
              ) : (
                <>
                  <th scope="col">Rank</th>
                  <th scope="col">{level}</th>
                  <th scope="col" style={{ textAlign: "right" }}>Value</th>
                </>
              )}
            </tr>
          </thead>
          {body}
        </table>
      </TableFrame>
      {all.length > shown && (
        <Group justify="center" mt="xs">
          <Button size="xs" variant="default" onClick={() => setShown((n) => n + ROW_LIMIT)}>Show 100 more</Button>
        </Group>
      )}
    </div>
  );
}
