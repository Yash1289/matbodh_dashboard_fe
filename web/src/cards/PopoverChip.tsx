import { Popover, UnstyledButton } from "@mantine/core";
import type { CSSProperties, ReactNode } from "react";
import { tokens } from "../theme";

export const chipStyle = (selected: boolean): CSSProperties => ({
  background: selected ? "var(--mb-primary-soft)" : "var(--mb-surface)",
  border: `1px solid ${selected ? "var(--mb-primary)" : "var(--mb-chip-border)"}`,
  borderRadius: tokens.radius.chip,
  padding: "5px 10px",
  fontSize: tokens.font.chip,
  fontWeight: selected ? 600 : 500,
  color: selected ? "var(--mb-primary)" : "var(--mb-text)",
  whiteSpace: "nowrap",
});

/**
 * A chip that opens its controls in a popover. Focus moves into the popover on open and
 * returns to the chip on close, so Enter opens it and Escape closes it from the keyboard.
 */
export function PopoverChip({ label, selected, children }: { label: string; selected: boolean; children: ReactNode }) {
  return (
    <Popover position="bottom-start" shadow="md" withinPortal trapFocus returnFocus transitionProps={{ duration: 0 }}>
      <Popover.Target>
        <UnstyledButton style={chipStyle(selected)}>{label}</UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>{children}</Popover.Dropdown>
    </Popover>
  );
}
