import { Alert, Button, Drawer, Group, Menu, NativeSelect, SegmentedControl, Skeleton, Stack, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
import { useMemo, useState, type ReactNode } from "react";
import { useCardPlan, useCardRun } from "../../api/queries";
import { toCardRef } from "../../api/types";
import type { CardInfo, Density, RankedPayload, RunError, StateContext } from "../../api/types";
import { tokens } from "../../theme";
import { coverageNote } from "../coverage";
import { downloadCsv } from "../CardShell";
import { CohortDialog } from "../../cohorts/CohortDialog";
import { MethodDrawer } from "../MethodDrawer";
import { PopoverChip, chipStyle } from "../PopoverChip";
import { RankedTable } from "./RankedTable";
import { rankedToCsv } from "./rankedCsv";
import { initialRankedView, rankedRows, type RankedView } from "./rankedRows";

const DENSITIES: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" }, { value: "standard", label: "Standard" }, { value: "detailed", label: "Detailed" },
];

/** Infrastructure messages are never shown raw; other kinds carry a client-safe message. */
function errorText(e: RunError): string {
  if (e.kind === "infrastructure") return "Temporary engine problem — try Refresh";
  if (e.kind === "too_heavy") return `This ranking is too heavy: ${e.message}`;
  return e.message;
}

const Progress = ({ children }: { children: ReactNode }) => (
  <Stack gap="xs" aria-live="polite">
    <Skeleton height={8} />
    <Text size="sm">{children}</Text>
  </Stack>
);

/**
 * The chosen sort remembers a round by name (obs ids are positional: o1 can be a different round after the
 * selection changes). Resolve it to this payload's obs id; a round no longer shown falls back to the engine order.
 */
const settled = (view: RankedView, p: RankedPayload): RankedView => {
  if (view.sort === null) return view;
  const item = p.rounds.items.find((i) => i.base_name === view.sort!.round);
  return { ...view, sort: item ? { ...view.sort, round: item.obs_id } : null };
};

/** One ranking card: runs the engine for its config (one job per round in a trend), then shows the ranked table. */
export function RankingCard({ info, ctx }: { info: CardInfo; ctx: StateContext }) {
  const ref = toCardRef(info);
  const plan = useCardPlan(ref, ctx);
  const blocked = plan.data !== undefined && plan.data.unavailable.length > 0;
  const run = useCardRun<RankedPayload>(ref, ctx, plan.isSuccess && !blocked);
  const status = run.status;
  const errored = plan.isError || run.error !== null || status?.state === "failed";
  const shown = blocked || errored ? null : run.current ?? run.previous;

  const [chosen, setChosen] = useState<Partial<RankedView>>({});
  const [methodOpen, setMethodOpen] = useState(false);
  const [cohortOpen, setCohortOpen] = useState(false);
  const view = useMemo(
    () => (shown === null ? null : settled({ ...initialRankedView(shown), ...chosen }, shown)),
    [chosen, shown],
  );
  const onView = (patch: Partial<RankedView>) => setChosen((c) => ({ ...c, ...patch }));

  const labelOf = (obs: string) => shown?.rounds.items.find((i) => i.obs_id === obs)?.label ?? obs;
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
    const failed = status?.state === "partial"
      ? Object.values(status.errors).flatMap((e) => e.jobs).map((j) => (j.includes(":") ? labelOf(j.split(":")[1]) : "the ranking"))
      : [];
    body = (
      <Stack gap="xs">
        {failed.length > 0 && <Alert color="yellow" p="xs">{`Some parts failed: ${failed.join(", ")}`}</Alert>}
        <RankedTable payload={run.current} view={view} />
        <Text fz={tokens.font.subtitle} c="var(--mb-muted)" data-testid="card-footer">
          {[coverageNote(run.current.rounds),
            ...run.current.not_asked.map((n) => `Not asked in ${n.rounds.join(", ")}`),
            `Method: rules ${run.current.rules_version} · engine ${run.current.engine_version} · metadata r${run.current.metadata_revision}`,
          ].join(" · ")}
        </Text>
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
    body = <Progress>{status ? `${status.done} of ${status.total} runs done` : "Starting run…"}</Progress>;
  }

  const items = errored ? [] : shown?.rounds.items ?? plan.data?.rounds ?? [];
  const anchorName = items.find((r) => r.obs_id === (shown && !errored ? shown.rounds.anchor : null))?.base_name ?? ctx.anchor_round;
  const subtitle = [
    anchorName ? `anchor round ${anchorName}` : null,
    shown?.mode === "trend" ? `trend ${items.map((r) => r.base_name).join(" | ")}` : null,
    info.rank ? `ranked by ${info.rank.metric}${info.rank.party_id ? ` (${info.rank.party_id})` : ""}` : null,
  ].filter((p) => p !== null).join(" · ");

  const rounds = shown ? rankedRows(shown, { ...view!, search: "" }).rounds : [];
  const sortOptions = [
    { value: "", label: "No sort" },
    ...rounds.flatMap((r) => [
      { value: `${r}:rank:asc`, label: `${labelOf(r)} rank, low to high` },
      { value: `${r}:rank:desc`, label: `${labelOf(r)} rank, high to low` },
      { value: `${r}:value:desc`, label: `${labelOf(r)} value, high to low` },
      { value: `${r}:value:asc`, label: `${labelOf(r)} value, low to high` },
    ]),
  ];

  return (
    <div data-testid={`card:${info.id}`} style={{
      background: "var(--mb-surface)", border: "1px solid var(--mb-border)", borderRadius: tokens.radius.card,
      padding: "17px 19px",
    }}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={4} fz={tokens.font.cardTitle} fw={700} c="var(--mb-text)">{info.title}</Title>
            {subtitle && <Text fz={tokens.font.subtitle} c="var(--mb-muted)" data-testid="card-subtitle">{subtitle}</Text>}
          </div>
          {shown && view && (
            <Group gap={8} wrap="wrap" justify="flex-end">
              <PopoverChip label="Sort ▾" selected={view.sort !== null}>
                <NativeSelect size="xs" aria-label="Sort" data={sortOptions}
                  value={view.sort ? `${view.sort.round}:${view.sort.by}:${view.sort.dir}` : ""}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    const [round, by, dir] = v.split(":");
                    const name = shown.rounds.items.find((i) => i.obs_id === round)?.base_name;
                    onView({ sort: v === "" || !name ? null : { round: name, by: by as "rank" | "value", dir: dir as "asc" | "desc" } });
                  }} />
              </PopoverChip>
              <PopoverChip label="Search ▾" selected={view.search !== ""}>
                <TextInput size="xs" aria-label="Search rows" placeholder="Search rows" value={view.search}
                  onChange={(e) => onView({ search: e.currentTarget.value })} />
              </PopoverChip>
              <PopoverChip label={`Density: ${DENSITIES.find((d) => d.value === view.density)?.label} ▾`} selected={view.density !== "standard"}>
                <SegmentedControl size="xs" aria-label="Density" data={DENSITIES} value={view.density}
                  onChange={(v) => onView({ density: v as Density })} />
              </PopoverChip>
              <UnstyledButton style={chipStyle(view.showDetails)} aria-pressed={view.showDetails}
                onClick={() => onView({ showDetails: !view.showDetails })}>Details</UnstyledButton>
              <Menu position="bottom-end">
                <Menu.Target>
                  <Button variant="default" style={{ border: "1px solid var(--mb-chip-border)", padding: "8px 14px", fontSize: tokens.font.button, fontWeight: 500, height: "auto" }}>⋯</Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={() => setMethodOpen(true)}>How this was calculated</Menu.Item>
                  <Menu.Item disabled={run.current === null}
                    onClick={() => downloadCsv(`${info.id}.csv`, rankedToCsv(shown, rankedRows(shown, view)))}>Export CSV</Menu.Item>
                  <Menu.Item onClick={run.refresh}>Refresh</Menu.Item>
                  {info.family === "seat_ranking" && <Menu.Item onClick={() => setCohortOpen(true)}>Make cohort…</Menu.Item>}
                </Menu.Dropdown>
              </Menu>
            </Group>
          )}
        </Group>
        {body}
      </Stack>
      <CohortDialog opened={cohortOpen} onClose={() => setCohortOpen(false)} card={ref} kind="ranking" ctx={ctx}
        reference={null} hasReference={false} cardTitle={info.title} />
      <Drawer opened={methodOpen} onClose={() => setMethodOpen(false)} title="How this was calculated" position="right">
        <MethodDrawer payload={shown} plan={plan.data ?? null} errors={status?.errors ?? {}} />
      </Drawer>
    </div>
  );
}
