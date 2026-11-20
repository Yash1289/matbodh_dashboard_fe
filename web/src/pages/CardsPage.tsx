import { Button, Group, Modal, Skeleton, Stack, Text, Title } from "@mantine/core";
import { useEffect, useState } from "react";
import { useCards, useFamilies } from "../api/queries";
import {
  isBenchmarkFamily, isRankingFamily, isRelationshipFamily,
  type CardConfigJson, type CardInfo, type FamilyDescriptor, type FamilyMeta, type StateContext,
} from "../api/types";
import { BenchmarkCard } from "../cards/benchmark/BenchmarkCard";
import { CardShell } from "../cards/CardShell";
import { RankingCard } from "../cards/ranking/RankingCard";
import { RelationshipCard } from "../cards/relationship/RelationshipCard";
import { AddCardMenu } from "../configure/AddCardMenu";
import { Canvas } from "../canvas/Canvas";
import { useWorkspace, workspaceStore } from "../canvas/workspaceStore";
import { cardStore, configOfInfo, useStoredCards, type StoredCard } from "../configure/cardStore";
import { ConfigurePanel } from "../configure/ConfigurePanel";
import { ContextStep } from "../context/ContextStep";
import { useDashboardContext } from "../context/urlContext";
import { tokens } from "../theme";

/** A stored config as the card components expect it: library-shaped, marked inline. */
function infoOfStored(stored: StoredCard, meta: FamilyMeta): CardInfo {
  const c = stored.config;
  return {
    section: "cards", scenarios: [], cuts: [[]], filters: [], caste_clubbing: false, requires: { min_level: "state" },
    ...c,
    comparison: { mode: "standalone", target: null, reference: null, delta_measures: [], ...c.comparison },
    meta, inline: true,
  } as unknown as CardInfo;
}

const renderCard = (c: CardInfo, ctx: StateContext) => (isBenchmarkFamily(c.family)
  ? <BenchmarkCard key={c.id} info={c} ctx={ctx} />
  : isRelationshipFamily(c.family)
    ? <RelationshipCard key={c.id} info={c} ctx={ctx} />
    : isRankingFamily(c.family)
      ? <RankingCard key={c.id} info={c} ctx={ctx} />
      : <CardShell key={c.id} info={c} ctx={ctx} />);

const UNDO_MS = 10_000;

type Editing = { kind: "new"; descriptor: FamilyDescriptor } | { kind: "edit"; stored: StoredCard };

function CardsList({ ctx }: { ctx: StateContext }) {
  const library = useCards();
  const families = useFamilies();
  const stored = useStoredCards(ctx.state);
  const workspace = useWorkspace(ctx.state);
  const tab = workspace.tabs.find((t) => t.id === workspace.activeTab) ?? workspace.tabs[0];
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
  const metaOf = (family: string): FamilyMeta | undefined => families.data?.find((d) => d.family === family)?.meta;

  const apply = (config: CardConfigJson) => {
    if (editing?.kind === "new") workspaceStore.addCard(ctx.state, config);
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
    if (tab.items.length === 0) return <Text>This tab is empty. Add a card to start.</Text>;
    return (
      <Canvas state={ctx.state} tab={tab} renderCard={renderStored}
        onRemoved={(restore) => setUndo(() => restore)}
        onConfigure={(cardId) => { const s = stored.find((c) => c.id === cardId); if (s !== undefined) setEditing({ kind: "edit", stored: s }); }} />
    );
  })();

  return (
    <Stack gap={tokens.layout.gap}>
      <Group justify="space-between">
        <Title order={1} fz={tokens.font.pageTitle} fw={700}>{tab.name}</Title>
        <AddCardMenu families={families.data ?? []} library={libraryCards}
          onPickFamily={(descriptor) => setEditing({ kind: "new", descriptor })}
          onPickLibrary={(info) => workspaceStore.addCard(ctx.state, configOfInfo(info))} />
      </Group>
      {library.isError && <Text c="red" role="alert">{library.error.message}</Text>}
      {undo !== null && (
        <Group gap="xs" role="status">
          <Text size="sm">Card removed</Text>
          <Button variant="light" size="compact-sm" onClick={() => { undo(); setUndo(null); }}>Undo</Button>
        </Group>
      )}
      {body}
      <Modal opened={editing !== null} onClose={closeEditing} title="Configure card" size="lg" centered
        closeOnClickOutside={false} returnFocus={false} closeButtonProps={{ "aria-label": "Close" }}>
        {editing !== null && (
          <ConfigurePanel
            key={editing.kind === "new" ? `new:${editing.descriptor.family}` : editing.stored.id}
            family={editing.kind === "new" ? editing.descriptor.family : editing.stored.config.family}
            initial={editing.kind === "new"
              ? { id: "draft", family: editing.descriptor.family as CardConfigJson["family"], title: editing.descriptor.label }
              : editing.stored.config}
            ctx={ctx} onApply={apply} onCancel={closeEditing} />
        )}
      </Modal>
    </Stack>
  );
}

/** The analyst's own cards for the current context, plus any library cards the owner has shared. */
export function CardsPage() {
  const { ctx } = useDashboardContext();
  // Without a context the first step is the only content; nothing runs until it is chosen.
  return ctx === null ? <ContextStep /> : <CardsList ctx={ctx} />;
}
