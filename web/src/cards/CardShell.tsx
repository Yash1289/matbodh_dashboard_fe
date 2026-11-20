import { Alert, Button, Drawer, Group, Skeleton, Stack, Text, Title } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useCardPlan, useCardRun, useFieldScopes } from "../api/queries";
import { toCardRef } from "../api/types";
import type { CardInfo, GridFamily, GridPayload, PresentationRules, RunError, StateContext } from "../api/types";
import { toCsv } from "../table/csv";
import { tokens } from "../theme";
import { CardFooter } from "./CardFooter";
import { ControlStrip } from "./ControlStrip";
import { FAMILY_BODIES } from "./families";
import { payloadToGrid } from "./grid/payloadToGrid";
import { MethodDrawer } from "./MethodDrawer";
import { SeatSelector } from "./SeatSelector";
import { applySeat, resolveSeat, seatChoices, seatSplit } from "./seatScope";
import { sizeClass } from "./sizeClass";
import { initialView, settled, type FamilyView } from "./view";

interface Props {
  info: CardInfo;
  ctx: StateContext;
  presentationRules?: PresentationRules | null;
  order?: { rows?: string[]; columns?: string[]; pinLast?: string[] };
  colors?: Record<string, string>;
}

/** Infrastructure messages are never shown raw; other kinds carry a client-safe message. */
function errorText(e: RunError): string {
  if (e.kind === "infrastructure") return "Temporary engine problem — try Refresh";
  if (e.kind === "too_heavy") return `This cut is too heavy: ${e.message}`;
  return e.message;
}

export function downloadCsv(name: string, text: string) {
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

/** One card: runs the engine for its config, then hands the payload to its family's body. */
export function CardShell({ info, ctx, presentationRules, order, colors }: Props) {
  const cardRef = toCardRef(info);
  const plan = useCardPlan(cardRef, ctx);
  const blocked = plan.data !== undefined && plan.data.unavailable.length > 0;
  const run = useCardRun(cardRef, ctx, plan.isSuccess && !blocked);
  const status = run.status;
  // A newly unavailable or failed selection never shows stale numbers or metadata beside its error.
  const errored = plan.isError || run.error !== null || status?.state === "failed";
  const shown = blocked || errored ? null : run.current ?? run.previous;

  const [chosen, setChosen] = useState<FamilyView | null>(null);
  const [methodOpen, setMethodOpen] = useState(false);
  const { ref, width } = useElementSize();
  const view = useMemo(
    () => (shown === null ? null : settled(chosen ?? initialView(shown), shown)),
    [chosen, shown],
  );
  const onView = useCallback((patch: Partial<FamilyView>) => {
    // A different cut has a different seat field, so an earlier seat choice no longer applies.
    setChosen((v) => ({ ...(v ?? (shown !== null ? initialView(shown) : (patch as FamilyView))), ...patch, ...(patch.cut !== undefined ? { seat: undefined } : {}) }));
  }, [shown]);
  // A crossed cut whose first field describes the seat is read one seat group at a time (display only).
  const crossed = shown?.cuts.some((c) => c.dimensions.length >= 2) ?? false;
  const scopes = useFieldScopes(info.family, crossed ? ctx : null);
  const activeCut = shown !== null && view !== null ? shown.cuts.find((c) => c.id === view.cut) : undefined;
  const split = activeCut ? seatSplit(activeCut.dimensions, scopes) : null;
  const choices = split && shown && activeCut ? seatChoices(shown, activeCut, split.field) : null;
  const seat = choices ? resolveSeat(choices, view?.seat) : null;
  const withSeat = useCallback(
    (p: GridPayload): GridPayload => (split && view && choices ? applySeat(p, view.cut, split.field, seat) : p),
    [split, view, choices, seat],
  );
  const grid = useMemo(() => {
    if (shown === null || view === null || view.cut === "") return null;
    return payloadToGrid(withSeat(shown), { lens: view.lens, cut: view.cut });
  }, [shown, view, withSeat]);

  const refresh = <Button size="xs" variant="default" w="fit-content" onClick={run.refresh}>Refresh</Button>;
  const Body = FAMILY_BODIES[info.family as GridFamily]; // CardsPage routes ranking families to RankingCard
  const bodyOf = (p: GridPayload, v: FamilyView) => (
    <Body payload={withSeat(p)} view={v} onView={onView} rules={presentationRules} order={order} colors={colors} />
  );
  const previous = run.previous && !blocked && view && (
    <div>
      <Text size="xs" c="dimmed">Showing previous selection</Text>
      <div aria-busy="true" style={{ opacity: 0.5 }}>{bodyOf(run.previous, settled(view, run.previous))}</div>
    </div>
  );

  let body: ReactNode;
  if (plan.isPending) body = <Stack gap="xs"><Progress>Checking what this card can show…</Progress>{previous}</Stack>;
  else if (plan.error) body = <Text c="red" role="alert">{plan.error.message}</Text>;
  else if (blocked) {
    body = (
      <Stack gap={4} aria-disabled="true" style={{ opacity: 0.6 }}>
        {plan.data.unavailable.map((u) => <Text key={`${u.part}:${u.reason}`} size="sm">{u.reason}</Text>)}
      </Stack>
    );
  } else if (run.error) body = <Stack gap={4}><Text c="red" role="alert">{run.error.message}</Text>{refresh}</Stack>;
  else if (run.current && view && grid) {
    const failed = status?.state === "partial" ? Object.keys(status.errors) : [];
    body = (
      <Stack gap="xs">
        {failed.length > 0 && <Alert color="yellow" p="xs">{`Some parts failed: ${failed.join(", ")}`}</Alert>}
        {bodyOf(run.current, view)}
        <CardFooter payload={run.current} grid={grid} onMethod={() => setMethodOpen(true)} />
      </Stack>
    );
  } else if (run.current) {
    body = <Text size="sm">The engine returned no rows for this card.</Text>;
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
  // Round names are series-qualified; the bare R1/R2 labels only head columns inside the table.
  const anchor = nameOf(shown && !errored ? shown.rounds.anchor : ctx.anchor_round);
  // The reference is whatever the engine's deltas were measured against: another round, or another scenario in the same round.
  const firstDelta = shown?.mode === "compare" ? shown.cuts.flatMap((c) => c.deltas)[0] : undefined;
  const compare = firstDelta === undefined ? undefined : (() => {
    const [targetObs] = firstDelta.target.split(":");
    const [referenceObs, ...scenario] = firstDelta.reference.split(":");
    return referenceObs !== targetObs ? nameOf(referenceObs) : scenario.join(":");
  })();
  const subtitle = anchor === undefined ? null : [
    `anchor round ${anchor}`,
    compare === undefined ? null : `Δ vs ${compare}`,
    shown?.mode === "trend" ? `trend ${items.map((r) => r.base_name).join(" | ")}` : null,
  ].filter((p) => p !== null).join(" · ");

  return (
    <div ref={ref} data-testid={`card:${info.id}`} style={{
      background: "var(--mb-surface)", border: "1px solid var(--mb-border)", borderRadius: tokens.radius.card,
      padding: "17px 19px",
    }}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2} fz={tokens.font.cardTitle} fw={700} c="var(--mb-text)">{info.title}</Title>
            {subtitle && <Text fz={tokens.font.subtitle} c="var(--mb-muted)" title={roundsTitle} data-testid="card-subtitle">{subtitle}</Text>}
          </div>
          {shown && view && grid && (
            <ControlStrip
              payload={shown} view={view} onView={onView} size={width === 0 ? "wide" : sizeClass(width)}
              leading={split && choices && (
                <SeatSelector field={split.field} values={choices.values} hasAll={choices.all !== null} value={seat}
                  onChange={(v) => onView({ seat: v })} />
              )}
              onMethod={() => setMethodOpen(true)} onRefresh={run.refresh} canExport={run.current !== null}
              onExport={() => downloadCsv(`${info.id}.csv`, toCsv(grid))}
            />
          )}
        </Group>
        {body}
      </Stack>
      <Drawer opened={methodOpen} onClose={() => setMethodOpen(false)} title="How this was calculated" position="right">
        <MethodDrawer payload={shown} plan={plan.data ?? null} errors={status?.errors ?? {}} />
      </Drawer>
    </div>
  );
}
