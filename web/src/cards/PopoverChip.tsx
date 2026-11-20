import { Popover, UnstyledButton } from "@mantine/core";
import { useState, type CSSProperties, type ReactNode } from "react";
import { tokens } from "../theme";
import styles from "./chip.module.css";

export const chipStyle = (selected: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  background: selected ? "var(--mb-primary-soft)" : "var(--mb-surface)",
  border: `1px solid ${selected ? "var(--mb-soft-line)" : "var(--mb-chip-border)"}`,
  borderRadius: tokens.radius.chip,
  padding: "5px 10px",
  fontSize: tokens.font.chip,
  fontWeight: selected ? 600 : 500,
  color: selected ? "var(--mb-ink)" : "var(--mb-text)",
  whiteSpace: "nowrap",
});

/** Class and data attribute that give a chip its focus ring and its changed-from-default dot. */
export const chipProps = (selected: boolean) => ({
  className: styles.chip,
  "data-changed": selected ? ("true" as const) : undefined,
});

/**
 * A chip that opens its controls in a popover. Focus moves into the popover on open and
 * returns to the chip on close, so Enter opens it and Escape closes it from the keyboard.
 */
export function PopoverChip({ label, selected, children }: {
  label: ReactNode; selected: boolean;
  /** The controls; a function gets `close` so an action can dismiss the popover. */
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [opened, setOpened] = useState(false);
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" shadow="md" withinPortal trapFocus returnFocus transitionProps={{ duration: 0 }}>
      <Popover.Target>
        <UnstyledButton {...chipProps(selected)} style={chipStyle(selected)} onClick={() => setOpened((o) => !o)}>{label}</UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>{typeof children === "function" ? children(() => setOpened(false)) : children}</Popover.Dropdown>
    </Popover>
  );
}
