import { Alert, Button, Drawer, Group, Skeleton, Stack, Text, Title } from "@mantine/core";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useCardPlan, useCardRun } from "../api/queries";
import type {
  BattlegroundSeat,
  CardResult,
  PresentationRules,
  RunError,
  StateContext,
  Template,
} from "../api/types";
import { defaultPreset, partsFor } from "../cells/parts";
import { toCsv } from "../table/csv";
import { applyPresentationRules, gridFor, transpose, type SortSpec } from "../table/grid";
import { CardFooter } from "./CardFooter";
import { CardFilterBar, type FilterSpec, type SlicerSpec } from "./CardFilterBar";
import { CardToolbar, ruleOf, type View } from "./CardToolbar";
import { cardParts, partLabel } from "./coverage";
import { InvestigationDrawer, type SeatCohort, type SeatItem } from "./InvestigationDrawer";
import { MethodDrawer } from "./MethodDrawer";
import {
  BattlegroundSummaryBody,
  CompositeGridBody,
  RankedListBody,
  TransitionMatrixBody,
} from "./body";
import { tokens } from "../theme";

interface Props {
  template: Template;
  ctx: StateContext | null;
  /** The page's first card: its subtitle says so. */
  lead?: boolean;
  presentationRules?: PresentationRules | null;
  slicers?: SlicerSpec[];
  onSlicerChange?: (dimension: string, value: string) => void;
  filters?: FilterSpec[];
  onFilterChange?: (filterId: string, value: string) => void;
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

export function Card({
  template,
  ctx,
  lead = false,
  presentationRules,
  slicers,
  onSlicerChange,
  filters,
  onFilterChange,
}: Props) {
  const plan = useCardPlan(template.id, ctx);
  const blocked = plan.data !== undefined
    && cardParts(template).every((p) => plan.data.unavailable.some((u) => u.part === p));
  const run = useCardRun(template.id, ctx, plan.isSuccess && !blocked);
  // A card sliced by party zone starts diverging: its columns are shares of one party each.
  const initial = useMemo<View>(() => ({
    preset: defaultPreset(template),
    density: template.density,
    transposed: false,
    format: template.slices.length > 0 ? "diverging" : "none",
    within: "column",
    sort: null,
    lens: template.lenses?.default ?? "support_share",
  }), [template]);
  const [view, setView] = useState<View>(initial);
  const [methodOpen, setMethodOpen] = useState(false);
  const [investigateCohort, setInvestigateCohort] = useState<SeatCohort | null>(null);
  const onView = useCallback((patch: Partial<View>) => setView((v) => ({ ...v, ...patch })), []);
  const onSort = useCallback((sort: SortSpec | null) => onView({ sort }), [onView]);

  const [internalSlicers, setInternalSlicers] = useState<SlicerSpec[]>(
    () => slicers ?? template.slicers ?? []
  );
  const activeSlicers = slicers ?? internalSlicers;
  const handleSlicerChange = useCallback((dimension: string, value: string) => {
    if (onSlicerChange) {
      onSlicerChange(dimension, value);
    } else {
      setInternalSlicers((prev) =>
        prev.map((s) => (s.dimension === dimension ? { ...s, selected: value } : s))
      );
    }
  }, [onSlicerChange]);

  const [internalFilters, setInternalFilters] = useState<FilterSpec[]>(
    () => filters ?? template.filters ?? []
  );
  const activeFilters = filters ?? internalFilters;
  const handleFilterChange = useCallback((filterId: string, value: string) => {
    if (onFilterChange) {
      onFilterChange(filterId, value);
    } else {
      setInternalFilters((prev) =>
        prev.map((f) => (f.id === filterId ? { ...f, selected: value } : f))
      );
    }
  }, [onFilterChange]);

  const status = run.status;
  // A newly unavailable or failed selection never shows stale numbers or metadata beside its error.
  const errored = plan.isError || run.error !== null || status?.state === "failed";
  const shown = blocked || errored ? null : run.current ?? run.previous;
  const grid = useMemo(() => {
    if (shown === null) return null;
    const g = applyPresentationRules(
      gridFor(shown, view.lens ?? undefined),
      presentationRules ?? template.presentationRules
    );
    const baseGrid = view.transposed ? transpose(g) : g;
    const activeNonDefault = activeSlicers.find(
      (s) => s.selected && s.selected !== "All" && s.selected !== "All Zones" && s.selected !== s.options[0]
    );
    if (!activeNonDefault) return baseGrid;
    const target = activeNonDefault.selected.toLowerCase();
    const rows = baseGrid.rows.filter(
      (r) => r.key.toLowerCase() === target || r.label.toLowerCase() === target || r.label.toLowerCase().includes(target)
    );
    return rows.length > 0 ? { ...baseGrid, rows } : baseGrid;
  }, [shown, view.lens, view.transposed, presentationRules, template, activeSlicers]);

  const handleInvestigate = useCallback((cohortOrItem: any) => {
    if (!cohortOrItem) {
      setInvestigateCohort(null);
      return;
    }
    if (Array.isArray(cohortOrItem.seats)) {
      setInvestigateCohort(cohortOrItem as SeatCohort);
      return;
    }
    const bgSeats: BattlegroundSeat[] = shown?.battleground?.seats ?? [];
    const ids: string[] = cohortOrItem.seat_ids ?? [];
    const matchingSeats: SeatItem[] = (ids.length > 0
      ? bgSeats.filter((s) => ids.includes(s.seat_id))
      : bgSeats
    ).map((s) => ({
      name: s.seat_id,
      winner: s.winner,
      margin_pp: s.margin_pp,
      flip: s.flip,
    }));
    setInvestigateCohort({
      title: cohortOrItem.title ?? "Investigating Seats",
      totalSeats: cohortOrItem.count ?? cohortOrItem.totalSeats ?? matchingSeats.length,
      seats: matchingSeats,
    });
  }, [shown?.battleground?.seats]);

  if (ctx === null) return null;

  const parts = partsFor(view.preset, view.density, template.cell);
  const refresh = <Button size="xs" variant="default" w="fit-content" onClick={run.refresh}>Refresh</Button>;

  const renderAdapter = (result: CardResult) => {
    const adapter = template.body_adapter ?? "composite_grid";
    if (adapter === "ranked_list" && result.ranked_list) {
      return <RankedListBody data={result.ranked_list} onInvestigate={handleInvestigate} />;
    }
    if (adapter === "transition_matrix" && result.transition) {
      return (
        <TransitionMatrixBody
          data={result.transition}
          lens={view.lens as any}
          onLensChange={(l) => onView({ lens: l })}
        />
      );
    }
    if (adapter === "battleground_summary" && result.battleground) {
      return <BattlegroundSummaryBody data={result.battleground} onInvestigate={handleInvestigate} />;
    }
    return grid && (
      <CompositeGridBody
        grid={grid}
        parts={parts}
        rounds={result.rounds}
        rule={ruleOf(view)}
        sort={view.sort}
        onSort={onSort}
      />
    );
  };

  const previous = run.previous && !blocked && (
    <div>
      <Text size="xs" c="dimmed">Showing previous selection</Text>
      <div aria-busy="true" style={{ opacity: 0.5 }}>{renderAdapter(run.previous)}</div>
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
  else if (run.current && (grid || run.current.ranked_list || run.current.transition || run.current.battleground)) {
    const failed = status?.state === "partial" ? Object.keys(status.errors) : [];
    body = (
      <Stack gap="xs">
        {failed.length > 0 && (
          <Alert color="yellow" p="xs">{`Some parts failed: ${failed.map((p) => partLabel(p, run.current)).join(", ")}`}</Alert>
        )}
        {renderAdapter(run.current)}
        {grid && <CardFooter result={run.current} grid={grid} template={template} onMethod={() => setMethodOpen(true)} />}
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
  const nameOf = (id: string | null) => items.find((r) => r.obs_id === id)?.base_name;
  // The result knows the effective anchor/compare (the URL may leave them to the server's default).
  const anchor = nameOf(shown && !errored ? shown.rounds.anchor : ctx.anchor_round);
  const compare = nameOf(shown && !errored ? shown.rounds.compare : ctx.compare_round);
  const subtitle = anchor === undefined ? null : [
    `${lead ? "Lead card · " : ""}anchor round ${anchor}`,
    compare === undefined ? null : `Δ vs ${compare}`,
    items.length > 1 ? `trend ${items[0].label} → ${items[items.length - 1].label}` : null,
  ].filter((p) => p !== null).join(" · ");

  return (
    <div style={{
      background: "var(--mb-surface)", border: "1px solid var(--mb-border)", borderRadius: tokens.radius.card,
      padding: "17px 19px",
    }}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={4} fz={tokens.font.cardTitle} fw={700} c="var(--mb-text)">{template.title}</Title>
            {subtitle && <Text fz={tokens.font.subtitle} c="var(--mb-muted)" title={roundsTitle}>{subtitle}</Text>}
          </div>
          {grid && (
            <CardToolbar
              view={view}
              onView={onView}
              initial={initial}
              canSort={parts.includes("delta") || view.sort !== null}
              columns={grid.columns}
              onMethod={() => setMethodOpen(true)}
              onRefresh={run.refresh}
              canExport={run.current !== null}
              availableLenses={template.lenses?.options}
              onExport={() => run.current && downloadCsv(`${template.id}.csv`, toCsv(gridFor(run.current, view.lens ?? undefined), run.current.rounds))}
            />
          )}
        </Group>
        <CardFilterBar
          slicers={activeSlicers}
          onSlicerChange={handleSlicerChange}
          filters={activeFilters}
          onFilterChange={handleFilterChange}
        />
        {body}
      </Stack>
      <Drawer opened={methodOpen} onClose={() => setMethodOpen(false)} title="How this was calculated" position="right">
        <MethodDrawer result={shown} plan={plan.data ?? null} errors={status?.errors ?? {}} />
      </Drawer>
      <InvestigationDrawer
        opened={investigateCohort !== null}
        onClose={() => setInvestigateCohort(null)}
        cohort={investigateCohort}
      />
    </div>
  );
}
