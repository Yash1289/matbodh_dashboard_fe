import { Skeleton, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useCards } from "../api/queries";
import { isRankingFamily, type StateContext } from "../api/types";
import { CardShell } from "../cards/CardShell";
import { RankingCard } from "../cards/ranking/RankingCard";
import { useDashboardContext } from "../context/urlContext";
import { tokens } from "../theme";

function CardsList({ ctx }: { ctx: StateContext }) {
  const cards = useCards();
  const body = (() => {
    if (cards.isError) return <Text c="red" role="alert">{cards.error.message}</Text>;
    if (cards.isPending) return <Skeleton height={80} aria-label="Loading cards…" />;
    if (cards.data.length === 0) return <Text>No cards are available.</Text>;
    return (
      <SimpleGrid cols={1} spacing={tokens.layout.gap}>
        {cards.data.map((c) => (isRankingFamily(c.family)
          ? <RankingCard key={c.id} info={c} ctx={ctx} />
          : <CardShell key={c.id} info={c} ctx={ctx} />))}
      </SimpleGrid>
    );
  })();
  return (
    <Stack gap={tokens.layout.gap}>
      <Title order={1} fz={tokens.font.pageTitle} fw={700}>Cards</Title>
      {body}
    </Stack>
  );
}

/** Every card the engine defines, for the current context; the cards own their own requests. */
export function CardsPage() {
  const { ctx } = useDashboardContext();
  // Without a context the context bar's prompt is the only content; nothing runs.
  return ctx === null ? null : <CardsList ctx={ctx} />;
}
