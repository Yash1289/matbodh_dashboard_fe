import { Group, Stack, Tabs, Text } from "@mantine/core";
import { useState } from "react";
import type { RankedListResult, Unit } from "../../api/types";
import { formatValue } from "../../cells/format";
import { Delta } from "../../cells/pieces";
import { tokens } from "../../theme";

export interface RankedListBodyProps {
  data: RankedListResult;
  onInvestigate?: (cohort: any) => void;
}

export function RankedListBody({ data, onInvestigate }: RankedListBodyProps) {
  const partitions = data.partitions ?? [];
  const [activeTab, setActiveTab] = useState<string>(partitions[0]?.partition_key ?? "");

  const currentPartition = partitions.find((p) => p.partition_key === activeTab) ?? partitions[0];
  const items = currentPartition?.items ?? [];

  const resolveUnit = (measure: string, kind?: string): Unit => {
    if (measure === "net_score" || kind === "difference" || kind === "shakti" || measure === "comparison_delta") {
      return "pp";
    }
    if (measure === "seats") return "seats";
    return "pct";
  };

  const renderItems = (itemsToRender: typeof items) => (
    <Stack gap={0}>
      {itemsToRender.map((item, idx) => {
        const unit = resolveUnit(item.measure, item.kind);
        return (
          <Group
            key={`${item.rank}-${item.label}-${idx}`}
            justify="space-between"
            wrap="nowrap"
            py="xs"
            px={4}
            style={{
              borderBottom: "1px solid var(--mb-border)",
              cursor: onInvestigate ? "pointer" : "default",
            }}
            onClick={() => onInvestigate?.(item)}
          >
            <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 28,
                  height: 22,
                  padding: "0 6px",
                  borderRadius: tokens.radius.chip,
                  backgroundColor: "var(--mb-header-bg)",
                  color: "var(--mb-text)",
                  fontSize: tokens.font.chip,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                #{item.rank}
              </span>
              {item.colour && (
                <span
                  aria-hidden
                  style={{
                    backgroundColor: item.colour,
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <Group gap="xs" wrap="nowrap">
                  <Text fw={600} size="sm" c="var(--mb-text)" truncate>
                    {item.label}
                  </Text>
                  {item.tags && item.tags.length > 0 && (
                    <Group gap={4}>
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          style={{
                            fontSize: tokens.font.subLine,
                            color: "var(--mb-muted)",
                            backgroundColor: "var(--mb-header-bg)",
                            padding: "1px 6px",
                            borderRadius: tokens.radius.button,
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </Group>
                  )}
                </Group>
                {item.secondary && (
                  <Text size="xs" c="var(--mb-muted)">
                    {item.secondary}
                  </Text>
                )}
              </div>
            </Group>

            <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
              <span
                style={{
                  fontSize: tokens.font.composite,
                  fontWeight: 600,
                  color: "var(--mb-text)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatValue(item.value, unit)}
              </span>
              {item.delta !== null && item.delta !== undefined && (
                <Delta delta={item.delta} unit="pp" />
              )}
            </Group>
          </Group>
        );
      })}
    </Stack>
  );

  if (partitions.length === 0) {
    return <Text size="sm" c="dimmed">No ranked items</Text>;
  }

  return (
    <div>
      {partitions.length > 1 && (
        <Tabs value={activeTab} onChange={(val) => val && setActiveTab(val)}>
          <Tabs.List mb="xs">
            {partitions.map((p) => (
              <Tabs.Tab key={p.partition_key} value={p.partition_key}>
                {p.partition_label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      )}
      {renderItems(items)}
    </div>
  );
}
