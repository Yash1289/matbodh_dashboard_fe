import { Button, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { CardConfigJson, CohortRef } from "../api/types";
import { COHORT_TAB_ID, useCohortTab, workspaceStore } from "../canvas/workspaceStore";
import { useDashboardContext } from "../context/urlContext";
import { CardsList } from "../pages/CardsPage";
import { tokens } from "../theme";
import styles from "./cohort.module.css";
import { clearCohort, renameCohort } from "./cohortStore";

/** The first card of a cohort page: the overall vote share of every party question the survey asked (spec 5.3). */
export const COHORT_FIRST_CARD: CardConfigJson = { id: "draft", family: "distribution", title: "Overall vote share", all_party_scenarios: true };

function Heading({ state, cohort }: { state: string; cohort: CohortRef }) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = (save: boolean) => {
    if (save && draft !== null) renameCohort(state, draft);
    setDraft(null);
  };
  return (
    <div style={{ minWidth: 0, maxWidth: "100%", flex: "1 1 320px" }}>
      {draft === null ? (
        <Title order={1} fz={tokens.font.pageTitle} fw={700} className={styles.clip} title={cohort.label}>{cohort.label}</Title>
      ) : (
        <TextInput aria-label="Cohort name" value={draft} maxLength={120} autoFocus data-autofocus
          onChange={(e) => setDraft(e.currentTarget.value)} onBlur={() => finish(true)}
          onKeyDown={(e) => { if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); }} />
      )}
      <Group gap={4} mt={2} wrap="wrap">
        <Text size="sm" c="var(--mb-muted)">
          {cohort.seat_ids.length} {cohort.seat_level.toUpperCase()} seats · made {new Date(cohort.created_at).toLocaleString()} · this session only
        </Text>
        <Button variant="subtle" size="compact-sm" onClick={() => setDraft(cohort.label)}>Rename</Button>
        <Button variant="subtle" size="compact-sm" color="red" onClick={() => clearCohort(state)}>Clear cohort</Button>
      </Group>
    </div>
  );
}

/** The cohort page: a canvas of its own whose every card reads only the cohort's seats. */
export function CohortTab() {
  const { ctx } = useDashboardContext();
  const { search } = useLocation();
  const tab = useCohortTab(ctx?.state ?? null);
  const state = ctx?.state ?? null;
  const active = ctx?.cohort != null;
  // The first visit starts the canvas with the overall vote share; after that it is the analyst's to arrange.
  useEffect(() => {
    if (state !== null && active && workspaceStore.ensureCohortTab(state)) workspaceStore.addCard(state, COHORT_FIRST_CARD, COHORT_TAB_ID);
  }, [state, active]);
  if (ctx === null) return null;
  const cohort = ctx.cohort;
  if (!cohort) {
    return (
      <Stack gap="sm">
        <Text>No cohort is active. Use “Make cohort…” on a seat ranking or benchmark card.</Text>
        <Text component={Link} to={{ pathname: "/", search }} size="sm">Back to the cards</Text>
      </Stack>
    );
  }
  if (tab === undefined) return null;
  return (
    <CardsList ctx={ctx} tabId={COHORT_TAB_ID} heading={<Heading state={ctx.state} cohort={cohort} />}
      emptyText="This cohort has no cards. Add a card to read these seats." />
  );
}
