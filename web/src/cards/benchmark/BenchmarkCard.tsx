import { Button, Drawer, Group, Menu, NativeSelect, Skeleton, Stack, Text, TextInput, Title } from "@mantine/core";
import { useMemo, useState, type ReactNode } from "react";
import { useCardPlan, useCardRun, useElections } from "../../api/queries";
import type { BenchmarkPayload, BenchmarkReference, BenchmarkTable, CardInfo, RunError, StateContext } from "../../api/types";
import { tokens } from "../../theme";
import { coverageNote } from "../coverage";
import { downloadCsv } from "../CardShell";
import { MethodDrawer } from "../MethodDrawer";
import { PopoverChip } from "../PopoverChip";
import { benchmarkToCsv } from "./benchmarkCsv";
import { initialBenchmarkView, type BenchmarkView } from "./benchmarkRows";
import { anchorLabel, BenchmarkTables, referenceLabel, TABLE_LABELS } from "./BenchmarkTables";

/** Infrastructure messages are never shown raw; other kinds carry a client-safe message. */
function errorText(e: RunError): string {
  if (e.kind === "infrastructure") return "Temporary engine problem — try Refresh";
  if (e.kind === "too_heavy") return `This benchmark is too heavy: ${e.message}`;
  return e.message;
}

const Progress = ({ children }: { children: ReactNode }) => (
  <Stack gap="xs" aria-live="polite">
    <Skeleton height={8} />
    <Text size="sm">{children}</Text>
  </Stack>
);

const pickerValue = (r: BenchmarkReference) => (r.kind === "election" ? `election:${r.year}:${r.election_type}` : r.kind);
const fromPicker = (v: string): BenchmarkReference => {
  if (!v.startsWith("election:")) return { kind: v as "none" | "compare" };
  const [, year, election_type] = v.split(":");
  return { kind: "election", year: Number(year), election_type: election_type as "LS" | "VS" };
};

/**
 * One benchmark card: one engine run (about a minute for a state), shown as a table the user chooses.
 * The table chooser and search are display-only; the reference picker is the only control that re-runs the engine.
 */
export function BenchmarkCard({ info, ctx }: { info: CardInfo; ctx: StateContext }) {
  const elections = useElections(ctx.state);
  const referenceOptions = [
    { value: "none", label: "No reference" },
    ...(ctx.compare_round ? [{ value: "compare", label: `Compare round (${ctx.compare_round})` }] : []),
    ...(elections.data ?? []).map((e) => ({ value: `election:${e.year}:${e.election_type}`, label: e.label })),
  ];
  // The user's choice; null = the card's default (the context's compare round when it has one, else none).
  const [chosenReference, setReference] = useState<BenchmarkReference | null>(null);
  // A choice the context no longer offers (compare round dropped, another state) falls back to the default.
  // Election options are not known until the list loads, so an election choice is kept until then.
  const offered = chosenReference === null || referenceOptions.some((o) => o.value === pickerValue(chosenReference))
    || (chosenReference.kind === "election" && elections.data === undefined);
  const reference = offered ? chosenReference : null;
  const plan = useCardPlan(info.id, ctx, reference);
  const blocked = plan.data !== undefined && plan.data.unavailable.length > 0;
  const run = useCardRun<BenchmarkPayload>(info.id, ctx, plan.isSuccess && !blocked, reference);
  const status = run.status;
  const errored = plan.isError || run.error !== null || status?.state === "failed";
  // Never the previous run's payload: its reference, subtitle and method text would describe the old choice.
  const shown = blocked || errored ? null : run.current;

  const [chosen, setChosen] = useState<Partial<BenchmarkView>>({});
  const [methodOpen, setMethodOpen] = useState(false);
  const view = useMemo<BenchmarkView | null>(() => {
    if (shown === null) return null;
    const table = chosen.table && shown.tables_available.includes(chosen.table) ? chosen.table : shown.default_table;
    return { ...initialBenchmarkView(shown), ...chosen, table };
  }, [chosen, shown]);

  const effective = reference ?? { kind: ctx.compare_round ? "compare" : "none" } as BenchmarkReference;
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
    body = (
      <Stack gap="xs">
        <BenchmarkTables payload={run.current} view={view} />
        <Text fz={tokens.font.subtitle} c="var(--mb-muted)" data-testid="card-footer">
          {[coverageNote(run.current.rounds),
            `${run.current.other_label}: every party outside the major list, and NOTA`,
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
    body = <Progress>Running the benchmark — a state takes about a minute…</Progress>;
  }

  const subtitle = shown && !errored
    ? [`anchor round ${anchorLabel(shown)}`, shown.reference.kind === "none" ? null : `vs ${referenceLabel(shown)}`,
      shown.focal_party ? `focal ${shown.focal_party}` : null].filter((p) => p !== null).join(" · ")
    : "";

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
          <Group gap={8} wrap="wrap" justify="flex-end">
            {shown && view && (
              <PopoverChip label="Table ▾" selected={false}>
                <NativeSelect size="xs" aria-label="Table" value={view.table}
                  data={shown.tables_available.map((t: BenchmarkTable) => ({ value: t, label: TABLE_LABELS[t] }))}
                  onChange={(e) => { const table = e.currentTarget.value as BenchmarkTable; setChosen((c) => ({ ...c, table })); }} />
              </PopoverChip>
            )}
            <PopoverChip label="Reference ▾" selected={reference !== null}>
              <Stack gap={4}>
                <NativeSelect size="xs" aria-label="Reference" value={pickerValue(effective)} data={referenceOptions}
                  onChange={(e) => setReference(fromPicker(e.currentTarget.value))} />
                <Text fz={tokens.font.subtitle} c="var(--mb-muted)">Changing this re-runs the engine.</Text>
              </Stack>
            </PopoverChip>
            {shown && view && (
              <>
                <PopoverChip label="Search ▾" selected={view.search !== ""}>
                  <TextInput size="xs" aria-label="Search rows" placeholder="Search groups or parties" value={view.search}
                    onChange={(e) => { const search = e.currentTarget.value; setChosen((c) => ({ ...c, search })); }} />
                </PopoverChip>
                <Menu position="bottom-end">
                  <Menu.Target>
                    <Button variant="default" style={{ border: "1px solid var(--mb-chip-border)", padding: "8px 14px", fontSize: tokens.font.button, fontWeight: 500, height: "auto" }}>⋯</Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item onClick={() => setMethodOpen(true)}>How this was calculated</Menu.Item>
                    <Menu.Item disabled={run.current === null}
                      onClick={() => downloadCsv(`${info.id}.csv`, benchmarkToCsv(shown, view))}>Export CSV</Menu.Item>
                    <Menu.Item onClick={run.refresh}>Refresh</Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </>
            )}
          </Group>
        </Group>
        {body}
      </Stack>
      <Drawer opened={methodOpen} onClose={() => setMethodOpen(false)} title="How this was calculated" position="right">
        <MethodDrawer payload={shown} plan={plan.data ?? null} errors={status?.errors ?? {}} />
      </Drawer>
    </div>
  );
}
