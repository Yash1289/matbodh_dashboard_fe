import { Group, Text, UnstyledButton } from "@mantine/core";
import type { Level, PlanResponse, StateContext } from "../api/types";
import { tokens } from "../theme";

interface Props {
  rounds: PlanResponse["rounds"];
  versionMode: StateContext["version_mode"];
  level: Level;
  onToggleMatched(): void;
}

const VERSION_LABEL = { normal: "Normal", extrapolated: "Extrapolated" } as const;

export function CoverageStrip({ rounds, versionMode, level, onToggleMatched }: Props) {
  if (level !== "ac" && level !== "pc") return null;
  const matched = versionMode === "matched";
  return (
    <Group
      justify="space-between" wrap="wrap" gap="6px 12px" px={14} py={10}
      style={{ background: "var(--mb-surface)", border: "1px solid var(--mb-border)", borderRadius: tokens.radius.strip }}
    >
      <Group gap={16}>
        <Text fw={700} fz={tokens.font.subtitle}>Coverage</Text>
        {rounds.map((r) => (
          <Text key={r.base_name} fz={tokens.font.subtitle} c="var(--mb-muted)" title={r.base_name}>
            {`${r.label}: ${r.seats} seats · ${VERSION_LABEL[r.version]}${r.fallback ? " (no Extrapolated version)" : ""}`}
          </Text>
        ))}
      </Group>
      <Group gap={10}>
        <Text fz={tokens.font.headerSub} c="var(--mb-muted)">Applies to seat cards only</Text>
        <UnstyledButton
          type="button" aria-pressed={matched} onClick={onToggleMatched}
          fz={tokens.font.chip} fw={500}
          style={{
            padding: "5px 10px", borderRadius: tokens.radius.chip,
            border: `1px solid ${matched ? "var(--mb-primary)" : "var(--mb-chip-border)"}`,
            background: matched ? "var(--mb-primary-soft)" : "var(--mb-surface)",
            color: matched ? "var(--mb-primary)" : "var(--mb-text)",
          }}
        >
          Matched seats only
        </UnstyledButton>
      </Group>
    </Group>
  );
}
