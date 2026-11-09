import { Skeleton, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useCardPlan, useTemplates } from "../api/queries";
import { Card } from "../cards/Card";
import { useDashboardContext } from "../context/urlContext";
import { tokens } from "../theme";
import { CoverageStrip } from "./CoverageStrip";

const LEAD_CARD = "pulse.party_scoreboard";

export function StatePulse() {
  const { ctx, setCtx } = useDashboardContext();
  const templates = useTemplates("pulse");
  // Same query key as the context bar and the lead card, so this adds no request.
  const plan = useCardPlan(LEAD_CARD, ctx);
  // Without a context the context bar's prompt is the only content; nothing runs.
  if (ctx === null) return null;
  const body = (() => {
    if (templates.isError) return <Text c="red" role="alert">{templates.error.message}</Text>;
    if (templates.isPending) return <Skeleton height={80} aria-label="Loading cards…" />;
    if (templates.data.length === 0) return <Text>No cards are available for this section.</Text>;
    const [lead, ...rest] = templates.data;
    return (
      <>
        {lead && <Card template={lead} ctx={ctx} />}
        {/* Custom breakpoint key: 2 columns from 1200 px, 1 below. */}
        <SimpleGrid cols={{ base: 1, "1200px": 2 }} spacing={tokens.layout.gap}>
          {rest.map((t) => <Card key={t.id} template={t} ctx={ctx} />)}
        </SimpleGrid>
      </>
    );
  })();
  return (
    <Stack gap={tokens.layout.gap}>
      <div>
        <Title order={1} fz={tokens.font.pageTitle} fw={700}>State Pulse</Title>
        <Text fz={tokens.font.subtitle} c="var(--mb-muted)" mt={4}>
          Where does each party stand right now, and how has that moved across rounds?
        </Text>
      </div>
      {plan.data && (
        <CoverageStrip
          rounds={plan.data.rounds} versionMode={ctx.version_mode} level={ctx.level}
          onToggleMatched={() => setCtx({ ...ctx, version_mode: ctx.version_mode === "matched" ? "extrapolated" : "matched" })}
        />
      )}
      {body}
    </Stack>
  );
}
