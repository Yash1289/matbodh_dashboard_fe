import { Button, Drawer, Group, Menu, NativeSelect, Skeleton, Stack, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { memo, useMemo, useState, type ReactNode } from "react";
import { useCardPlan, useCardRun } from "../../api/queries";
import { toCardRef } from "../../api/types";
import type { CardInfo, RelationshipPayload, RelationshipTable, RunError, StateContext } from "../../api/types";
import chrome from "../card.module.css";
import { tokens } from "../../theme";
import { coverageNote } from "../coverage";
import { downloadCsv } from "../CardShell";
import { MethodDrawer } from "../LazyMethodDrawer";
import { methodNote } from "../notes";
import { PopoverChip, chipStyle } from "../PopoverChip";
import { sizeClass } from "../sizeClass";
import { TableChooser } from "../TableChooser";
import { RelationshipMatrixTable } from "./RelationshipMatrix";
import { RelationshipSummaryTable } from "./RelationshipSummary";
import { relationshipToCsv } from "./relationshipCsv";
import {
  cutsOf, initialRelationshipView, roundLabel, roundsWithData, valueLabel, valuesFor, type RelationshipView,
} from "./relationshipRows";

const TABLE_LABELS: Record<RelationshipTable, string> = { summary: "Flow summary", matrix: "Matrix" };

/** Infrastructure messages are never shown raw; other kinds carry a client-safe message. */
function errorText(e: RunError): string {
  if (e.kind === "infrastructure") return "Temporary engine problem — try Refresh";
  if (e.kind === "too_heavy") return `This relationship is too heavy: ${e.message}`;
  return e.message;
}

const Progress = ({ children }: { children: ReactNode }) => (
  <Stack gap="xs" aria-live="polite">
    <Skeleton height={8} />
    <Text size="sm">{children}</Text>
  </Stack>
);

/** Rounds the card asked for that came back with no result and are not explained by `not_asked`. */
function noResult(p: RelationshipPayload): string[] {
  const explained = new Set(p.not_asked.flatMap((n) => n.rounds));
  const present = new Set(roundsWithData(p));
  const names = p.rounds.items.filter((i) => !present.has(i.obs_id) && !explained.has(i.base_name)).map((i) => i.base_name);
  return names.length > 0 ? [`No result in ${names.join(", ")}`] : [];
}

/** The engine's recalled-vote scenarios are exactly vs_past and ls_past; any other origin is a current answer. */
const isRecalled = (scenario: string) => scenario.endsWith("_past");

/**
 * What the user chose, resolved against this payload: a table or round that is gone falls back to the default;
 * a cut that is gone falls back to the first cut. A value pair that does not exist is kept, so the table can say so.
 */
function settled(chosen: Partial<RelationshipView>, p: RelationshipPayload): RelationshipView {
  const base = initialRelationshipView(p);
  const cuts = cutsOf(p);
  const cut = cuts.find((c) => c.key === (chosen.cut ?? base.cut));
  const sameDimensions = cut !== undefined && chosen.values !== undefined
    && Object.keys(chosen.values).sort().join() === [...cut.dimensions].sort().join();
  const first = p.groups.find((g) => g.set_id === (cut?.key ?? base.cut));
  return {
    ...base, ...chosen,
    table: chosen.table && p.tables_available.includes(chosen.table) ? chosen.table : base.table,
    round: chosen.round && roundsWithData(p).includes(chosen.round) ? chosen.round : base.round,
    cut: cut?.key ?? base.cut,
    values: sameDimensions ? chosen.values! : { ...(first?.dimensions ?? {}) },
  };
}

/** One relationship card: one engine run, shown as a table the user chooses; every chip is display-only. */
function RelationshipCardBody({ info, ctx }: { info: CardInfo; ctx: StateContext }) {
  const ref = toCardRef(info);
  const plan = useCardPlan(ref, ctx);
  const blocked = plan.data !== undefined && plan.data.unavailable.length > 0;
  const run = useCardRun<RelationshipPayload>(ref, ctx, plan.isSuccess && !blocked);
  const status = run.status;
  const errored = plan.isError || run.error !== null || status?.state === "failed";
  // Never the previous run's payload: its subtitle and method text would describe the old run.
  const shown = blocked || errored ? null : run.current;

  const { ref: boxRef, width } = useElementSize();
  const [chosen, setChosen] = useState<Partial<RelationshipView>>({});
  const [methodOpen, setMethodOpen] = useState(false);
  const view = useMemo(() => (shown === null ? null : settled(chosen, shown)), [chosen, shown]);
  const onView = (patch: Partial<RelationshipView>) => setChosen((c) => ({ ...c, ...patch }));
  const refresh = <Button size="xs" variant="default" w="fit-content" onClick={run.refresh}>Refresh</Button>;

  let body: ReactNode;
  if (plan.isPending) body = <Progress>Checking what this card can show…</Progress>;
  else if (plan.error) body = <Text c="red" role="alert">{plan.error.message}</Text>;
  else if (blocked) {
    body = (
      <Stack gap={4} aria-disabled="true" style={{ opacity: 0.6 }}>
        {plan.data.unavailable.map((u) => <Text key={`${u.part}:${u.reason}`} size="sm">{u.reason}</Text>)}
      </Stack>
    );
  } else if (run.error) body = <Stack gap={4}><Text c="red" role="alert">{run.error.message}</Text>{refresh}</Stack>;
  else if (run.current && view) {
    const p = run.current;
    body = (
      <Stack gap="xs">
        {view.table === "matrix"
          ? <RelationshipMatrixTable payload={p} view={view} />
          : <RelationshipSummaryTable payload={p} view={view} />}
      </Stack>
    );
  } else if (status?.state === "failed") {
    body = (
      <Stack gap={4} role="alert">
        {Object.entries(status.errors).map(([part, e]) => (
          <Text key={part} size="sm" c="red"><b>{part}:</b> <span>{errorText(e)}</span></Text>
        ))}
        {refresh}
      </Stack>
    );
  } else {
    body = <Progress>Running the relationship…</Progress>;
  }

  const subtitle = shown && !errored
    ? [`anchor round ${roundLabel(shown, shown.rounds.anchor)}`, `${shown.origin} → ${shown.destination}`,
      shown.focal_party ? `focal ${shown.focal_party}` : null].filter((p) => p !== null).join(" · ")
    : "";
  const cuts = shown ? cutsOf(shown) : [];
  const dimensions = shown && view ? cuts.find((c) => c.key === view.cut)?.dimensions ?? [] : [];

  return (
    <div ref={boxRef} data-testid={`card:${info.id}`} className={chrome.card}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2} fz={tokens.font.cardTitle} fw={700} c="var(--mb-text)">{info.title}</Title>
            {subtitle && <Text fz={tokens.font.subtitle} c="var(--mb-muted)" data-testid="card-subtitle">{subtitle}</Text>}
          </div>
          {shown && view && (
            <Group gap={8} wrap="wrap" justify="flex-end">
              <TableChooser label="Table" value={view.table} size={width === 0 ? "wide" : sizeClass(width)}
                options={shown.tables_available.map((t) => ({ value: t, label: TABLE_LABELS[t] }))}
                onChange={(table: RelationshipTable) => onView({ table })} />
              {view.table === "matrix" && (
                <PopoverChip label="Round ▾" selected={false}>
                  <NativeSelect size="xs" aria-label="Round" value={view.round ?? ""}
                    data={roundsWithData(shown).map((r) => ({ value: r, label: roundLabel(shown, r) }))}
                    onChange={(e) => { const round = e.currentTarget.value; onView({ round }); }} />
                </PopoverChip>
              )}
              {cuts.length > 1 && (
                <PopoverChip label="Cut ▾" selected={false}>
                  <NativeSelect size="xs" aria-label="Cut" value={view.cut ?? ""}
                    data={cuts.map((c) => ({ value: c.key, label: c.dimensions.join(" × ") || "All respondents" }))}
                    onChange={(e) => {
                      const cut = e.currentTarget.value;
                      const first = shown.groups.find((g) => g.set_id === cut);
                      onView({ cut, values: { ...(first?.dimensions ?? {}) } });
                    }} />
                </PopoverChip>
              )}
              {view.table === "matrix" && dimensions.map((dim) => (
                <PopoverChip key={dim} label={`${dim} ▾`} selected={false}>
                  <NativeSelect size="xs" aria-label={dim} value={view.values[dim] ?? ""}
                    data={valuesFor(shown, view.cut ?? "", dim).map((v) => ({ value: v, label: valueLabel(v) }))}
                    onChange={(e) => { const value = e.currentTarget.value; onView({ values: { ...view.values, [dim]: value } }); }} />
                </PopoverChip>
              ))}
              {view.table === "summary" && (
                <PopoverChip label="Search ▾" selected={view.search !== ""}>
                  <TextInput size="xs" aria-label="Search rows" placeholder="Search groups" value={view.search}
                    onChange={(e) => { const search = e.currentTarget.value; onView({ search }); }} />
                </PopoverChip>
              )}
              <UnstyledButton style={chipStyle(view.showDetails)} aria-pressed={view.showDetails}
                onClick={() => onView({ showDetails: !view.showDetails })}>Details</UnstyledButton>
              <Menu position="bottom-end">
                <Menu.Target>
                  <Button variant="default" style={{ border: "1px solid var(--mb-chip-border)", padding: "8px 14px", fontSize: tokens.font.button, fontWeight: 500, height: "auto" }}>⋯</Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={() => setMethodOpen(true)}>How this was calculated</Menu.Item>
                  <Menu.Item onClick={() => downloadCsv(`${info.id}.csv`, relationshipToCsv(shown, view))}>Export CSV</Menu.Item>
                  <Menu.Item onClick={run.refresh}>Refresh</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          )}
        </Group>
        {body}
      </Stack>
      <Drawer opened={methodOpen} onClose={() => setMethodOpen(false)} title="How this was calculated" position="right">
        <MethodDrawer payload={shown} plan={plan.data ?? null} errors={status?.errors ?? {}}
          notes={shown === null ? [] : [coverageNote(shown.rounds), ...shown.not_asked.map((n) => `Not asked in ${n.rounds.join(", ")}`), ...noResult(shown),
            isRecalled(shown.origin) ? "Recalled vote, not longitudinal linkage" : "Same-row answers, not a panel",
            "Shares include respondents who chose smaller parties", methodNote(shown)]} />
      </Drawer>
    </div>
  );
}

/** Skipped when its card and context are unchanged, so one card's edit or move does not redraw every table. */
export const RelationshipCard = memo(RelationshipCardBody);
