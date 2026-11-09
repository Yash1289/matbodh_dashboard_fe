import { Skeleton, SimpleGrid, Stack, Text } from "@mantine/core";
import { useTemplates } from "../api/queries";
import { Card } from "../cards/Card";
import { useDashboardContext } from "../context/urlContext";

export function StatePulse() {
  const { ctx } = useDashboardContext();
  const templates = useTemplates("pulse");
  // Without a context the context bar's prompt is the only content; nothing runs.
  if (ctx === null) return null;
  if (templates.isError) return <Text c="red" role="alert">{templates.error.message}</Text>;
  if (templates.isPending) return <Skeleton height={80} aria-label="Loading cards…" />;
  if (templates.data.length === 0) return <Text>No cards are available for this section.</Text>;
  const [lead, ...rest] = templates.data;
  return (
    <Stack>
      {lead && <Card template={lead} ctx={ctx} />}
      {/* Custom breakpoint key: 2 columns from 1200 px, 1 below. */}
      <SimpleGrid cols={{ base: 1, "1200px": 2 }}>
        {rest.map((t) => <Card key={t.id} template={t} ctx={ctx} />)}
      </SimpleGrid>
    </Stack>
  );
}
