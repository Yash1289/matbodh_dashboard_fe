import { Divider, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import type { ReactNode } from "react";
import { tokens } from "../theme";
import { PopoverChip } from "./PopoverChip";

export interface ViewRow {
  id: string;
  label: string;
  /** The setting's current value, shown beside its name so the menu reads as a summary. */
  value: string;
  selected: boolean;
  /** The control that edits the setting. A toggle has none: the whole row is the control. */
  node?: ReactNode;
  toggle?: { pressed: boolean; onToggle: () => void };
}

export interface ViewAction {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

const badge = {
  minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, marginLeft: 6, display: "inline-grid", placeItems: "center",
  background: "var(--mb-border)", color: "var(--mb-muted)", fontSize: 12,
} as const;

/** The View chip: the settings behind it with their current values, and the card's actions. */
export function ViewMenu({ rows, actions }: { rows: ViewRow[]; actions: ViewAction[] }) {
  const changed = rows.filter((r) => r.selected).length;
  return (
    <PopoverChip label={<>View{changed > 0 && <span style={badge}>{changed}</span>}</>} selected={changed > 0}>
      {(close) => (
      <Stack gap="sm" miw={250}>
        {rows.map((r) => (
          <div key={r.id} data-testid={`view-row-${r.id}`}>
            {r.toggle ? (
              <UnstyledButton w="100%" aria-pressed={r.toggle.pressed} onClick={r.toggle.onToggle}>
                <Group justify="space-between">
                  <Text size="xs" fw={600}>{r.label}</Text>
                  <Text size="xs" c="var(--mb-muted)">{r.value}</Text>
                </Group>
              </UnstyledButton>
            ) : (
              <>
                <Group justify="space-between" mb={4}>
                  <Text size="xs" fw={600}>{r.label}</Text>
                  <Text size="xs" c="var(--mb-muted)">{r.value}</Text>
                </Group>
                {r.node}
              </>
            )}
          </div>
        ))}
        <Divider />
        {actions.map((a) => (
          <UnstyledButton key={a.id} disabled={a.disabled} onClick={() => { close(); a.onSelect(); }} fz={tokens.font.button}
            style={{ opacity: a.disabled ? 0.5 : 1, textAlign: "left" }}>
            {a.label}
          </UnstyledButton>
        ))}
      </Stack>
      )}
    </PopoverChip>
  );
}
