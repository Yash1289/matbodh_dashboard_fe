import { Alert, Badge, Button, Drawer, Group, Paper, Skeleton, Stack, Text, Title } from "@mantine/core";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useCardPlan, useCardRun } from "../api/queries";
import type { CardResult, RunError, StateContext, Template } from "../api/types";
import { defaultPreset, partsFor } from "../cells/parts";
import { CompositeTable } from "../table/CompositeTable";
import { toCsv } from "../table/csv";
import { gridFor, transpose, type SortSpec } from "../table/grid";
import { CardFooter } from "./CardFooter";
import { CardToolbar, ruleOf, type View } from "./CardToolbar";
import { cardParts, partLabel } from "./coverage";
import { MethodDrawer } from "./MethodDrawer";

interface Props {
  template: Template;
  ctx: StateContext | null;
}

/** Infrastructure messages are never shown raw; other kinds carry a client-safe message. */
function errorText(e: RunError): string {
  if (e.kind === "infrastructure") return "Temporary engine problem — try Refresh";
  if (e.kind === "too_heavy") return `This cut is too heavy: ${e.message}`;
  return e.message;
}

function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url)); // after the browser has started the download
}

const Progress = ({ children }: { children: ReactNode }) => (
  <Stack gap="xs" aria-live="polite">
    <Skeleton height={8} />
    <Text size="sm">{children}</Text>
  </Stack>
);

export function Card({ template, ctx }: Props) {
  const plan = useCardPlan(template.id, ctx);
  const blocked = plan.data !== undefined
    && cardParts(template).every((p) => plan.data.unavailable.some((u) => u.part === p));
  const run = useCardRun(template.id, ctx, plan.isSuccess && !blocked);
  const [view, setView] = useState<View>(() => ({
    preset: defaultPreset(template), density: template.density, transposed: false,
    format: "none", within: "column", sort: null,
  }));
  const [methodOpen, setMethodOpen] = useState(false);
  const onView = useCallback((patch: Partial<View>) => setView((v) => ({ ...v, ...patch })), []);
  const onSort = useCallback((sort: SortSpec | null) => onView({ sort }), [onView]);

  const status = run.status;
  // A newly unavailable or failed selection never shows stale numbers or metadata beside its error.
  const errored = plan.isError || run.error !== null || status?.state === "failed";
  const shown = blocked || errored ? null : run.current ?? run.previous;
  const grid = useMemo(() => {
    if (shown === null) return null;
    const g = gridFor(shown);
    return view.transposed ? transpose(g) : g;
  }, [shown, view.transposed]);

  if (ctx === null) return null;

  const table = (result: CardResult) => grid && (
    <CompositeTable grid={grid} parts={partsFor(view.preset, view.density, template.cell)}
      rounds={result.rounds} rule={ruleOf(view)} sort={view.sort} onSort={onSort} />
  );
  const refresh = <Button size="xs" variant="default" w="fit-content" onClick={run.refresh}>Refresh</Button>;

  const previous = run.previous && !blocked && (
    <div>
      <Text size="xs" c="dimmed">Showing previous selection</Text>
      <div aria-busy="true" style={{ opacity: 0.5 }}>{table(run.previous)}</div>
    </div>
  );

  let body: ReactNode;
  if (plan.isPending) body = <Stack gap="xs"><Progress>Checking what this card can show…</Progress>{previous}</Stack>;
  else if (plan.error) body = <Text c="red" role="alert">{plan.error.message}</Text>;
  else if (blocked) {
    body = (
      <Stack gap={4} aria-disabled="true" style={{ opacity: 0.6 }}>
        {plan.data.unavailable.map((u) => <Text key={u.part} size="sm">{partLabel(u.part, null)}: {u.reason}</Text>)}
      </Stack>
    );
  } else if (run.error) body = <Stack gap={4}><Text c="red" role="alert">{run.error.message}</Text>{refresh}</Stack>;
  else if (run.current && grid) {
    const failed = status?.state === "partial" ? Object.keys(status.errors) : [];
    body = (
      <Stack gap="xs">
        {failed.length > 0 && (
          <Alert color="yellow" p="xs">{`Some parts failed: ${failed.map((p) => partLabel(p, run.current)).join(", ")}`}</Alert>
        )}
        {table(run.current)}
        <CardFooter result={run.current} grid={grid} template={template} />
      </Stack>
    );
  } else if (status?.state === "failed") {
    body = (
      <Stack gap={4} role="alert">
        {Object.entries(status.errors).map(([part, e]) => (
          <Text key={part} size="sm" c="red"><b>{partLabel(part, null)}:</b> <span>{errorText(e)}</span></Text>
        ))}
        {refresh}
      </Stack>
    );
  } else {
    body = (
      <Stack gap="xs">
        <Progress>{status ? `${status.done} of ${status.total} runs done` : "Starting run…"}</Progress>
        {previous}
      </Stack>
    );
  }

  const items = errored ? [] : shown?.rounds.items ?? plan.data?.rounds ?? [];
  const roundsTitle = items
    .map((r) => `${r.base_name} · ${r.version}${r.fallback ? " (no Extrapolated version)" : ""} · ${r.seats} seats · ${r.dataset_id}`)
    .join("\n");

  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <Title order={4}>{template.title}</Title>
            {items.length > 0 && <Badge variant="light" title={roundsTitle}>{`${items.length} rounds`}</Badge>}
          </Group>
          {grid && (
            <CardToolbar view={view} onView={onView} columns={grid.columns}
              onMethod={() => setMethodOpen(true)} onRefresh={run.refresh} canExport={run.current !== null}
              onExport={() => run.current && downloadCsv(`${template.id}.csv`, toCsv(gridFor(run.current), run.current.rounds))} />
          )}
        </Group>
        {body}
      </Stack>
      <Drawer opened={methodOpen} onClose={() => setMethodOpen(false)} title="How this was calculated" position="right">
        <MethodDrawer result={shown} plan={plan.data ?? null} errors={status?.errors ?? {}} />
      </Drawer>
    </Paper>
  );
}
