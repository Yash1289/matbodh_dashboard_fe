import { Button, Group, Modal, Skeleton, Stack, Text, Title } from "@mantine/core";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useCards, useFamilies } from "../api/queries";
import {
  isBenchmarkFamily, isRankingFamily, isRelationshipFamily,
  type CardConfigJson, type CardInfo, type FamilyDescriptor, type FamilyMeta, type StateContext,
} from "../api/types";
import { CardShell } from "../cards/CardShell";
import { AddCardMenu } from "../configure/AddCardMenu";
import { Canvas } from "../canvas/Canvas";
import { COHORT_TAB_ID, useCohortTab, useWorkspace, workspaceStore } from "../canvas/workspaceStore";
import { cardStore, configOfInfo, useStoredCards, type StoredCard } from "../configure/cardStore";
import { ContextStep } from "../context/ContextStep";
import { useDashboardContext } from "../context/urlContext";
import { tokens } from "../theme";

// Families other than the plain grid, and the Configure panel, load when first needed.
const BenchmarkCard = lazy(() => import("../cards/benchmark/BenchmarkCard").then((m) => ({ default: m.BenchmarkCard })));
const RankingCard = lazy(() => import("../cards/ranking/RankingCard").then((m) => ({ default: m.RankingCard })));
const RelationshipCard = lazy(() => import("../cards/relationship/RelationshipCard").then((m) => ({ default: m.RelationshipCard })));
const ConfigurePanel = lazy(() => import("../configure/ConfigurePanel").then((m) => ({ default: m.ConfigurePanel })));

const infoCache = new WeakMap<StoredCard, { meta: FamilyMeta; info: CardInfo }>();

/** A stored config as the card components expect it: library-shaped, marked inline. The same object for the same card, so an unchanged card is not redrawn. */
function infoOfStored(stored: StoredCard, meta: FamilyMeta): CardInfo {
  const hit = infoCache.get(stored);
  if (hit !== undefined && hit.meta === meta) return hit.info;
  const info = buildInfo(stored, meta);
  infoCache.set(stored, { meta, info });
  return info;
}

function buildInfo(stored: StoredCard, meta: FamilyMeta): CardInfo {
  const c = stored.config;
  return {
    section: "cards", scenarios: [], cuts: [[]], filters: [], caste_clubbing: false, requires: { min_level: "state" },
    ...c,
    comparison: { mode: "standalone", target: null, reference: null, delta_measures: [], ...c.comparison },
    meta, inline: true,
  } as unknown as CardInfo;
}

const renderCard = (c: CardInfo, ctx: StateContext) => (
  <Suspense key={c.id} fallback={<Skeleton height={80} aria-label="Loading card…" />}>{renderFamily(c, ctx)}</Suspense>
);

const renderFamily = (c: CardInfo, ctx: StateContext) => (isBenchmarkFamily(c.family)
  ? <BenchmarkCard key={c.id} info={c} ctx={ctx} />
  : isRelationshipFamily(c.family)
    ? <RelationshipCard key={c.id} info={c} ctx={ctx} />
    : isRankingFamily(c.family)
      ? <RankingCard key={c.id} info={c} ctx={ctx} />
      : <CardShell key={c.id} info={c} ctx={ctx} />);

const UNDO_MS = 10_000;

type Editing = { kind: "new"; descriptor: FamilyDescriptor } | { kind: "edit"; stored: StoredCard };

/**
 * The cards of one tab with the way to add, configure and remove them. Without `tabId` it is the active tab;
 * the cohort page passes its own canvas and a heading of its own.
 */
export function CardsList({ ctx, tabId, heading, emptyText }: { ctx: StateContext; tabId?: string; heading?: ReactNode; emptyText?: string }) {
  const library = useCards();
  const families = useFamilies();
  const stored = useStoredCards(ctx.state);
  const workspace = useWorkspace(ctx.state);
  const cohortTab = useCohortTab(ctx.state);
  const tab = (tabId === COHORT_TAB_ID ? cohortTab : workspace.tabs.find((t) => t.id === workspace.activeTab)) ?? workspace.tabs[0];
  const [editing, setEditing] = useState<Editing | null>(null);
  // The way to take back the last Remove; offered for a while, then forgotten.
  const [undo, setUndo] = useState<(() => void) | null>(null);
  useEffect(() => {
    if (undo === null) return undefined;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);
  /** Close Configure and put focus back on what opened it (its menu unmounts, so the modal cannot do it). */
  const closeEditing = () => {
    const opener = editing;
    setEditing(null);
    requestAnimationFrame(() => {
      const el = opener?.kind === "edit"
        ? document.querySelector(`[data-card-body="${CSS.escape(opener.stored.id)}"]`)?.parentElement?.querySelector<HTMLElement>('button[aria-label^="Card actions"]')
        : document.querySelector<HTMLElement>("[data-add-card]");
      el?.focus();
    });
  };
  const editingFamily = editing === null ? null : editing.kind === "new" ? editing.descriptor.family : editing.stored.config.family;
  const dialogTitle = `Configure ${(families.data?.find((d) => d.family === editingFamily)?.label ?? "card").toLowerCase()}`;
  const metaOf = (family: string): FamilyMeta | undefined => families.data?.find((d) => d.family === family)?.meta;

  const apply = (config: CardConfigJson) => {
    if (editing?.kind === "new") workspaceStore.addCard(ctx.state, config, tab.id);
    else if (editing?.kind === "edit") cardStore.replace(ctx.state, editing.stored.id, config);
    closeEditing();
  };

  const renderStored = (cardId: string) => {
    const s = stored.find((c) => c.id === cardId);
    const meta = s === undefined ? undefined : metaOf(s.config.family);
    return s === undefined || meta === undefined ? null : renderCard(infoOfStored(s, meta), ctx);
  };

  const libraryCards = library.data ?? [];
  const body = (() => {
    if (families.isPending) return <Skeleton height={80} aria-label="Loading cards…" />;
    if (tab.items.length === 0) return <Text>{emptyText ?? "This tab is empty. Add a card to start."}</Text>;
    return (
      <Canvas state={ctx.state} tab={tab} renderCard={renderStored}
        onRemoved={(restore) => setUndo(() => restore)}
        onConfigure={(cardId) => { const s = stored.find((c) => c.id === cardId); if (s !== undefined) setEditing({ kind: "edit", stored: s }); }} />
    );
  })();

  return (
    <Stack gap={tokens.layout.gap}>
      <Group justify="space-between">
        {heading ?? <Title order={1} fz={tokens.font.pageTitle} fw={700}>{tab.name}</Title>}
        <AddCardMenu families={families.data ?? []} library={libraryCards}
          onPickFamily={(descriptor) => setEditing({ kind: "new", descriptor })}
          onPickLibrary={(info) => workspaceStore.addCard(ctx.state, configOfInfo(info), tab.id)} />
      </Group>
      {library.isError && <Text c="red" role="alert">{library.error.message}</Text>}
      {undo !== null && (
        <Group gap="xs" role="status">
          <Text size="sm">Card removed</Text>
          <Button variant="light" size="compact-sm" onClick={() => { undo(); setUndo(null); }}>Undo</Button>
        </Group>
      )}
      {body}
      <Modal opened={editing !== null} onClose={closeEditing} title={dialogTitle} size="min(960px, 94vw)" centered
        closeOnClickOutside={false} returnFocus={false} closeButtonProps={{ "aria-label": "Close" }}>
        {editing !== null && (
          <Suspense fallback={<Skeleton height={160} aria-label="Loading settings…" />}><ConfigurePanel
            key={editing.kind === "new" ? `new:${editing.descriptor.family}` : editing.stored.id}
            family={editing.kind === "new" ? editing.descriptor.family : editing.stored.config.family}
            initial={editing.kind === "new"
              ? { id: "draft", family: editing.descriptor.family as CardConfigJson["family"], title: editing.descriptor.label }
              : editing.stored.config}
            ctx={ctx} onApply={apply} onCancel={closeEditing} /></Suspense>
        )}
      </Modal>
    </Stack>
  );
}

/** The analyst's own cards for the current context, plus any library cards the owner has shared. */
export function CardsPage() {
  const { ctx } = useDashboardContext();
  // A cohort narrows only its own page's cards (the sub-tab); the tabs' cards keep reading the whole state.
  const whole = useMemo(() => (ctx !== null && ctx.cohort ? { ...ctx, cohort: null } : ctx), [ctx]);
  // Without a context the first step is the only content; nothing runs until it is chosen.
  return whole === null ? <ContextStep /> : <CardsList ctx={whole} />;
}
