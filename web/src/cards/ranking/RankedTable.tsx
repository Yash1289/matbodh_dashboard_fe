import { Button, Group, Text } from "@mantine/core";
import { Fragment, useMemo, useState } from "react";
import type { AbsentReason, RankedPayload, Unit } from "../../api/types";
import { formatValue } from "../../cells/format";
import { tokens } from "../../theme";
import { rankedRows, tieKeys, type RankedSlot, type RankedView } from "./rankedRows";

const ROW_LIMIT = 100;
const PADDING = { compact: 2, standard: 5, detailed: 9 } as const;

const unitOf = (p: RankedPayload): Unit => (p.unit === "percentage_points" ? "pp" : "pct");

const reasonText = (reason: AbsentReason, label: string, topK: number | null): string =>
  reason === "outside_top_k" ? `outside top ${topK ?? "k"} in ${label}`
    : reason === "not_ranked" ? `not ranked in ${label}`
      : `calculation failed in ${label}`;

/** One segment per round, separated by thin rules like the grid's trend pipes. */
function Pipe({ slots, text }: { slots: RankedSlot[]; text: (slot: RankedSlot) => { shown: string; label: string; title?: string } }) {
  return (
    <div role="group" style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      {slots.map((slot, i) => {
        const { shown, label, title } = text(slot);
        return (
          <Fragment key={slot.round}>
            {i > 0 && <span aria-hidden style={{ alignSelf: "stretch", width: 1, background: "var(--mb-border)" }} />}
            <span data-segment aria-label={label} title={title}>{shown}</span>
          </Fragment>
        );
      })}
    </div>
  );
}

/** `ac_num: 12` reads "AC 12"; other dimensions keep their value with a spaced name. */
const partitionText = (name: string, value: string | null): string =>
  name.endsWith("_num") ? `${name.slice(0, -4).toUpperCase()} ${value ?? "—"}` : `${name.replace(/_/g, " ")}: ${value ?? "—"}`;

interface Props { payload: RankedPayload; view: RankedView }

/** Ranked rows grouped by partition; every number is the engine's, absent slots say why. */
export function RankedTable({ payload, view }: Props) {
  const model = useMemo(() => rankedRows(payload, view), [payload, view]);
  const [shown, setShown] = useState(ROW_LIMIT);
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
  const pad = PADDING[view.density];
  const cell = { padding: `${pad}px 10px`, textAlign: "left" as const, fontWeight: 400 };
  const partitioned = payload.partition_by.length > 0;
  const seat = payload.entity_kind === "seat";

  let remaining = shown;
  const body = model.groups.flatMap(({ group, rows }) => {
    const visible = rows.slice(0, Math.max(remaining, 0));
    remaining -= visible.length;
    if (visible.length === 0) return [];
    const eligible = view.showDetails ? Object.values(group.eligible_count).find((n) => n !== null) : undefined;
    const header = partitioned && (
      <tr key={`g:${group.key}`}>
        <th colSpan={3} scope="rowgroup" style={{ ...cell, fontWeight: 600, background: "var(--mb-surface-alt, transparent)" }}>
          {Object.entries(group.partition).map(([k, v]) => partitionText(k, v)).join(" · ")}
          {eligible !== undefined && ` · ${eligible} ranked`}
        </th>
      </tr>
    );
    const rowsOut = visible.map((row) => {
      const labels = row.entity.labels;
      const rankText = (slot: RankedSlot) => {
        if (slot.kind === "absent") {
          const why = reasonText(slot.reason, labelOf(slot.round), payload.top_k);
          return { shown: "—", label: `${labelOf(slot.round)}: ${why}`, title: why };
        }
        const tied = slot.round === payload.rounds.anchor && ties.has(row.key);
        return { shown: slot.rank === null ? "—" : `${tied ? "=" : ""}${slot.rank}`,
          label: `${labelOf(slot.round)}: rank ${slot.rank ?? "unavailable"}${tied ? " (tied)" : ""}`,
          title: tied ? "Tied with another row" : undefined };
      };
      const valueText = (slot: RankedSlot) => {
        if (slot.kind === "absent") return rankText(slot);
        const text = formatValue(slot.value, unit);
        const base = view.showDetails ? bases.get(`${row.group.key}\u0000${row.entity.key}\u0000${slot.round}`) : undefined;
        return { shown: base === undefined || base === null ? text : `${text} (base ${Math.round(base * 100) / 100})`,
          label: `${labelOf(slot.round)}: ${text}`,
          title: slot.value === null ? `no value (${slot.status})` : undefined };
      };
      return (
        <tr key={row.key}>
          <th scope="row" style={cell}>
            {seat ? (
              <>
                {labels.name !== undefined && <strong>{labels.name} </strong>}
                <small style={{ color: "var(--mb-muted)" }}>{payload.level.toUpperCase()} {labels.seat_id}</small>
              </>
            ) : labels[payload.level]}
          </th>
          <td style={cell}><Pipe slots={row.slots} text={rankText} /></td>
          <td style={cell}><Pipe slots={row.slots} text={valueText} /></td>
        </tr>
      );
    });
    return [<tbody key={group.key}>{header}{rowsOut}</tbody>];
  });

  if (model.groups.length === 0) {
    const needle = view.search.trim();
    return <Text size="sm" role="status">{needle === "" ? "The engine returned no ranked rows." : `No rows match “${needle}”.`}</Text>;
  }

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: tokens.font.chip }}>
        <caption style={{ textAlign: "left", color: "var(--mb-muted)", paddingBottom: 6 }}>
          {unit === "pp" ? "Percentage points" : "Percentage"} · ranked {payload.direction === "ASC" ? "lowest" : "highest"} first
          {payload.top_k !== null && ` · top ${payload.top_k} per ${partitioned ? "partition" : "ranking"}`}
        </caption>
        <thead>
          <tr>
            <th scope="col" style={cell}>{seat ? payload.level.toUpperCase() : payload.level}</th>
            <th scope="col" style={cell}>Rank{model.rounds.length > 1 ? ` (${model.rounds.map(labelOf).join(" | ")})` : ""}</th>
            <th scope="col" style={cell}>Value{model.rounds.length > 1 ? ` (${model.rounds.map(labelOf).join(" | ")})` : ""}</th>
          </tr>
        </thead>
        {body}
      </table>
      {all.length > shown && (
        <Group justify="center" mt="xs">
          <Button size="xs" variant="default" onClick={() => setShown((n) => n + ROW_LIMIT)}>Show 100 more</Button>
        </Group>
      )}
    </div>
  );
}
