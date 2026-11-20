import { NativeSelect, UnstyledButton } from "@mantine/core";
import { PopoverChip, chipProps } from "./PopoverChip";
import type { SizeClass } from "./sizeClass";

interface Props<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  size: SizeClass;
}

/** Which table a card shows: a row of tabs on a wide card, one chip on a smaller one. */
export function TableChooser<T extends string>({ label, value, options, onChange, size }: Props<T>) {
  const current = options.find((o) => o.value === value)?.label ?? value;
  if (size === "wide") {
    return (
      <div role="tablist" aria-label={label} style={{ display: "flex", gap: 4 }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <UnstyledButton key={o.value} role="tab" aria-selected={active} className={chipProps(false).className}
              onClick={() => onChange(o.value)}
              style={{
                padding: "6px 10px", fontSize: 13, fontWeight: active ? 600 : 500, whiteSpace: "nowrap",
                color: active ? "var(--mb-ink)" : "var(--mb-muted)",
                borderBottom: `2px solid ${active ? "var(--mb-primary)" : "transparent"}`, borderRadius: "6px 6px 0 0",
              }}>
              {o.label}
            </UnstyledButton>
          );
        })}
      </div>
    );
  }
  return (
    <PopoverChip label={`${label}: ${current} ▾`} selected={false}>
      <NativeSelect size="xs" aria-label={label} value={value} data={options}
        onChange={(e) => onChange(e.currentTarget.value as T)} />
    </PopoverChip>
  );
}
