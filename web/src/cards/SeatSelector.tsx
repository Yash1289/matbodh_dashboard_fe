import { Popover, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import { useState } from "react";
import { chipProps } from "./PopoverChip";

interface Props {
  field: string;
  values: string[];
  /** The engine returned an All table for the remaining fields, so "All" is a choice. */
  hasAll: boolean;
  /** `null` is All. */
  value: string | null;
  onChange: (value: string | null) => void;
}

const step = {
  width: 24, height: 24, borderRadius: "50%", display: "grid", placeItems: "center", color: "var(--mb-ink)", fontSize: 14,
} as const;

/** Picks which seat group a crossed table is about. Display only: it never starts a run. */
export function SeatSelector({ field, values, hasAll, value, onChange }: Props) {
  const name = field.replace(/_/g, " ");
  const [query, setQuery] = useState("");
  const items: (string | null)[] = hasAll ? [null, ...values] : values;
  const index = items.indexOf(value);
  const prev = index > 0 ? items[index - 1] : undefined;
  const next = index >= 0 && index < items.length - 1 ? items[index + 1] : undefined;
  const position = value === null ? `${values.length} values` : `${values.indexOf(value) + 1} / ${values.length}`;
  const needle = query.trim().toLowerCase();
  const shown = items.filter((v) => needle === "" || (v ?? "all").toLowerCase().includes(needle));

  return (
    <div role="group" aria-label={name} style={{
      display: "inline-flex", alignItems: "center", gap: 4, height: 32, padding: "0 8px 0 12px", whiteSpace: "nowrap",
      background: "var(--mb-primary-soft)", border: "1px solid var(--mb-soft-line)", borderRadius: 16,
      color: "var(--mb-ink)", fontSize: 13, fontWeight: 600,
    }}>
      <Popover position="bottom-start" shadow="md" withinPortal trapFocus returnFocus transitionProps={{ duration: 0 }}
        onClose={() => setQuery("")}>
        <Popover.Target>
          <UnstyledButton {...chipProps(false)} aria-haspopup="listbox" style={{ display: "inline-flex", gap: 6, borderRadius: 8 }}>
            <span style={{ fontWeight: 500 }}>{name}</span>
            <span>{value ?? "All"}</span>
          </UnstyledButton>
        </Popover.Target>
        <Popover.Dropdown>
          <Stack gap={6} miw={260}>
            <TextInput size="xs" type="search" aria-label={`Find ${name}`} placeholder={`Find ${name}`} value={query}
              onChange={(e) => setQuery(e.currentTarget.value)} />
            <div role="listbox" aria-label={name} style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column" }}>
              {shown.map((v) => (
                <UnstyledButton key={v ?? "__all"} role="option" aria-selected={v === value} onClick={() => onChange(v)}
                  className={chipProps(false).className}
                  style={{ padding: "7px 10px", borderRadius: 8, fontSize: 13, fontWeight: v === value ? 600 : 400,
                    background: v === value ? "var(--mb-primary-soft)" : "transparent", color: v === value ? "var(--mb-ink)" : "var(--mb-text)" }}>
                  {v ?? "All"}
                </UnstyledButton>
              ))}
              {shown.length === 0 && <Text size="xs" c="var(--mb-muted)" p={8}>{`No ${name} matches “${query.trim()}”.`}</Text>}
            </div>
          </Stack>
        </Popover.Dropdown>
      </Popover>
      <UnstyledButton {...chipProps(false)} aria-label={`Previous ${name}`} disabled={prev === undefined}
        onClick={() => prev !== undefined && onChange(prev)} style={{ ...step, opacity: prev === undefined ? 0.35 : 1 }}>‹</UnstyledButton>
      <span style={{ fontWeight: 500, opacity: 0.85 }}>{position}</span>
      <UnstyledButton {...chipProps(false)} aria-label={`Next ${name}`} disabled={next === undefined}
        onClick={() => next !== undefined && onChange(next)} style={{ ...step, opacity: next === undefined ? 0.35 : 1 }}>›</UnstyledButton>
    </div>
  );
}
