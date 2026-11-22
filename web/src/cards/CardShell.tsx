import { Alert, Button, Drawer, Group, Skeleton, Stack, Text, Title } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { useCardPlan, useCardRun, useFieldScopes } from "../api/queries";
import { toCardRef } from "../api/types";
import type { CardInfo, GridFamily, GridPayload, PresentationRules, RunError, StateContext } from "../api/types";
import { toCsv } from "../table/csv";
import chrome from "./card.module.css";
import { tokens } from "../theme";
import { ControlStrip } from "./ControlStrip";
import { FAMILY_BODIES } from "./families";
import { gridFor } from "./grid/cascade";
import { MethodDrawer } from "./LazyMethodDrawer";
import { gridNotes } from "./notes";
import { SeatSelector } from "./SeatSelector";
import { LayoutSelectors } from "./LayoutSelectors";
import { layoutPayload } from "./grid/layout";
import { applySeat, narrowChain, resolveSeat, seatChain, seatChoices, seatSplit } from "./seatScope";
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
function CardShellBody({ info, ctx, presentationRules, order, colors }: Props) {
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
  // The view is settled twice: first against the payload (cut and lens), then against the columns the layout
  // actually shows, so hidden columns and sorts refer to what the table has, not to the raw payload's columns.
  // A crossed cut whose first field describes the seat is read one seat group at a time (display only).
  const crossed = shown?.cuts.some((c) => c.dimensions.length >= 2) ?? false;
  const scopes = useFieldScopes(info.family, crossed ? ctx : null);
  const seatFields = useMemo(() => new Set(Object.entries(scopes).filter(([, s]) => s === "seat").map(([f]) => f)), [scopes]);
  const view1 = useMemo(
    () => (shown === null ? null : settled(chosen ?? initialView(shown, seatFields), shown, seatFields)),
    [chosen, shown, seatFields],
  );
  const onView = useCallback((patch: Partial<FamilyView>) => {
    // A different cut has a different seat field, so an earlier seat choice no longer applies.
    setChosen((v) => ({ ...(v ?? (shown !== null ? initialView(shown, seatFields) : (patch as FamilyView))), ...patch, ...(patch.cut !== undefined ? { seat: undefined } : {}) }));
  }, [shown, seatFields]);
  const activeCut = shown !== null && view1 !== null ? shown.cuts.find((c) => c.id === view1.cut) : undefined;
  const split = activeCut ? seatSplit(activeCut.dimensions, scopes) : null;
  const choices = split && shown && activeCut ? seatChoices(shown, activeCut, split.field) : null;
  const seat = choices ? resolveSeat(choices, view1?.seat) : null;
  // A View by seat: Cascaded reads every table of the chain for one value of the seat field at a time.
  const chainField = shown !== null && view1?.density === "cascaded" ? seatChain(shown.cuts, scopes) : null;
  const chainSource = chainField !== null && shown !== null ? shown.cuts.find((c) => c.dimensions[0] === chainField) : undefined;
  const chainChoices = chainField !== null && shown !== null && chainSource ? { ...seatChoices(shown, chainSource, chainField), all: null } : null;
  const chainSeat = chainChoices ? resolveSeat(chainChoices, view1?.seat) : null;
  const withSeat = useCallback(
    (p: GridPayload): GridPayload => {
      const seated = chainField !== null && chainSeat !== null ? narrowChain(p, chainField, chainSeat)
        : split && view1 && choices ? applySeat(p, view1.cut, split.field, seat) : p;
      return view1 ? layoutPayload(seated, view1.cut, view1) : seated;
    },
    [split, view1, choices, seat, chainField, chainSeat],
  );
  const laid = useMemo(() => (shown !== null && view1 !== null ? withSeat(shown) : null), [shown, view1, withSeat]);
  const view = useMemo(
    () => (view1 === null || laid === null || shown === null ? view1
      : settled({ ...(chosen ?? initialView(shown, seatFields)), cut: view1.cut, lens: view1.lens }, laid, seatFields)),
    [view1, laid, chosen, shown, seatFields],
  );
  const grid = useMemo(() => {
    if (shown === null || view === null || view.cut === "") return null;
    return gridFor(withSeat(shown), { lens: view.lens, cut: view.cut, density: view.density });
  }, [shown, view, withSeat]);

  const refresh = <Button size="xs" variant="default" w="fit-content" onClick={run.refresh}>Refresh</Button>;
  const Body = FAMILY_BODIES[info.family as GridFamily]; // CardsPage routes ranking families to RankingCard
  const bodyOf = (p: GridPayload, v: FamilyView) => (
    <Body payload={withSeat(p)} view={v} onView={onView} rules={presentationRules} order={order} colors={colors} />
  );
  const previous = run.previous && !blocked && view && (
    <div>
      <Text size="xs" c="dimmed">Showing previous selection</Text>
      <div aria-busy="true" style={{ opacity: 0.5 }}>{bodyOf(run.previous, settled(view, run.previous, seatFields))}</div>
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

  return (
    <div ref={ref} data-testid={`card:${info.id}`} className={chrome.card}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2} fz={tokens.font.cardTitle} fw={700} c="var(--mb-text)">{info.title}</Title>
          </div>
          {shown && view && grid && (
            <ControlStrip
              payload={laid ?? shown} view={view} onView={onView} seatFields={seatFields} size={width === 0 ? "wide" : sizeClass(width)}
              leading={(
                <>
                  {chainField !== null && chainChoices ? (
                    <SeatSelector field={chainField} values={chainChoices.values} hasAll={false} value={chainSeat}
                      onChange={(v) => onView({ seat: v })} />
                  ) : split && choices && (
                    <SeatSelector field={split.field} values={choices.values} hasAll={choices.all !== null} value={seat}
                      onChange={(v) => onView({ seat: v })} />
                  )}
                  <LayoutSelectors payload={shown} cut={view.cut} view={view} onView={onView} />
                </>
              )}
              onMethod={() => setMethodOpen(true)} onRefresh={run.refresh} canExport={run.current !== null}
              onExport={() => downloadCsv(`${info.id}.csv`, toCsv(grid))}
            />
          )}
        </Group>
        {body}
      </Stack>
      <Drawer opened={methodOpen} onClose={() => setMethodOpen(false)} title="How this was calculated" position="right">
        <MethodDrawer payload={shown} plan={plan.data ?? null} errors={status?.errors ?? {}} notes={shown !== null && grid !== null ? gridNotes(shown, grid) : []} />
      </Drawer>
    </div>
  );
}

/** Skipped when its card and context are unchanged, so one card's edit or move does not redraw every table. */
export const CardShell = memo(CardShellBody);
