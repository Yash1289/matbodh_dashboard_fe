import { Button, Group, Skeleton, Stack, Text, Title } from "@mantine/core";
import { Link, useLocation } from "react-router-dom";
import { useCards } from "../api/queries";
import { CardShell } from "../cards/CardShell";
import { useDashboardContext } from "../context/urlContext";
import { tokens } from "../theme";
import { clearCohort } from "./cohortStore";

export const COHORT_CARD = "distribution.overall_vote_share";

/** The cohort canvas: just the overall vote share of the cohort's seats; more cards are added later. */
export function CohortTab() {
  const { ctx } = useDashboardContext();
  const { search } = useLocation();
  const cards = useCards();
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
  const info = cards.data?.find((c) => c.id === COHORT_CARD);
  return (
    <Stack gap={tokens.layout.gap}>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={1} fz={tokens.font.pageTitle} fw={700}>Cohort</Title>
          <Text>{cohort.label}</Text>
          <Text size="sm" c="var(--mb-muted)">
            {cohort.seat_ids.length} {cohort.seat_level.toUpperCase()} seats · made {new Date(cohort.created_at).toLocaleString()} · this session only
          </Text>
        </div>
        <Button variant="default" onClick={() => clearCohort(ctx.state)}>Clear cohort</Button>
      </Group>
      {cards.isPending ? <Skeleton height={80} aria-label="Loading card…" />
        : info === undefined ? <Text role="alert">The overall vote-share card is not configured.</Text>
          : <CardShell info={info} ctx={ctx} />}
    </Stack>
  );
}
