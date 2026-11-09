import { Button, Card, Group, Paper, Stack, Text } from "@mantine/core";
import type { BattlegroundResult } from "../../api/types";
import { tokens } from "../../theme";

export interface BattlegroundSummaryBodyProps {
  data: BattlegroundResult;
  onInvestigate?: (cohort: { flip?: string; title: string; count: number; seat_ids: string[] }) => void;
}

export function BattlegroundSummaryBody({ data, onInvestigate }: BattlegroundSummaryBodyProps) {
  const { flips, margin_buckets = [], seats = [] } = data;

  const handleInvestigateGain = () => {
    const gainSeats = seats.filter((s) => s.flip === "gain").map((s) => s.seat_id);
    onInvestigate?.({
      flip: "gain",
      title: `${flips.gain} Gained Seats`,
      count: flips.gain,
      seat_ids: gainSeats,
    });
  };

  return (
    <Stack gap="md">
      {/* KPI Flip Cards */}
      <Group gap="md" grow>
        <Paper
          p="sm"
          withBorder
          style={{
            borderRadius: tokens.radius.card,
            backgroundColor: "var(--mb-header-bg)",
            textAlign: "center",
          }}
        >
          <Text size="xs" c="dimmed" fw={600} tt="uppercase">
            Winning Both
          </Text>
          <Text size="lg" fw={700} c="var(--mb-text)">
            Held ({flips.winning_both})
          </Text>
        </Paper>

        <Paper
          p="sm"
          withBorder
          style={{
            borderRadius: tokens.radius.card,
            borderColor: "var(--mb-gain)",
            backgroundColor: "rgba(13, 128, 77, 0.06)",
            textAlign: "center",
          }}
        >
          <Text size="xs" c="var(--mb-gain)" fw={600} tt="uppercase">
            New Pickups
          </Text>
          <Text size="lg" fw={700} c="var(--mb-gain)">
            Gain (+{flips.gain})
          </Text>
        </Paper>

        <Paper
          p="sm"
          withBorder
          style={{
            borderRadius: tokens.radius.card,
            borderColor: "var(--mb-loss)",
            backgroundColor: "rgba(191, 51, 51, 0.06)",
            textAlign: "center",
          }}
        >
          <Text size="xs" c="var(--mb-loss)" fw={600} tt="uppercase">
            Surrendered Seats
          </Text>
          <Text size="lg" fw={700} c="var(--mb-loss)">
            Lost (-{Math.abs(flips.loss)})
          </Text>
        </Paper>

        {flips.losing_both !== undefined && (
          <Paper
            p="sm"
            withBorder
            style={{
              borderRadius: tokens.radius.card,
              backgroundColor: "var(--mb-header-bg)",
              textAlign: "center",
            }}
          >
            <Text size="xs" c="dimmed" fw={600} tt="uppercase">
              Losing Both
            </Text>
            <Text size="lg" fw={700} c="var(--mb-muted)">
              Opp Held ({flips.losing_both})
            </Text>
          </Paper>
        )}
      </Group>

      {/* Margin Buckets Distribution */}
      {margin_buckets.length > 0 && (
        <Card p="sm" withBorder style={{ borderRadius: tokens.radius.card }}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb="xs">
            Margin Distribution
          </Text>
          <Group gap="xs" grow>
            {margin_buckets.map((b) => (
              <Paper
                key={b.bucket}
                p="xs"
                style={{
                  backgroundColor: "var(--mb-header-bg)",
                  borderRadius: tokens.radius.button,
                  textAlign: "center",
                }}
              >
                <Text size="xs" c="dimmed" fw={500}>
                  {b.bucket}
                </Text>
                <Text size="sm" fw={700} c="var(--mb-text)">
                  {b.count} seats
                </Text>
              </Paper>
            ))}
          </Group>
        </Card>
      )}

      {/* CTA Button */}
      <Group justify="flex-end">
        <Button
          variant="light"
          color="mb"
          size="sm"
          onClick={handleInvestigateGain}
          style={{ borderRadius: tokens.radius.button }}
        >
          Investigate gained seats &rarr;
        </Button>
      </Group>
    </Stack>
  );
}
