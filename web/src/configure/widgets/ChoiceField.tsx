import { Checkbox, NativeSelect, Stack, Text } from "@mantine/core";
import { useOptions } from "../../api/queries";
import type { OptionItem } from "../../api/types";
import { asParams, optionLabel, type WidgetProps } from "./types";

/**
 * One widget for every pick-from-a-list field: fixed choices, or an option list from the backend
 * (scenarios, metrics, parties, fields). Single values use a select; several use checkboxes.
 */
export function ChoiceField({ field, value, onChange, draft, ctx, error }: WidgetProps) {
  const fetched = useOptions(field.options?.source ?? "", asParams(field), draft, field.options ? ctx : null);
  const items: OptionItem[] = field.choices
    ? field.choices.map((c) => ({ value: c, label: c, kind: null, recalled: false, disabled_reason: null }))
    : fetched.data ?? [];

  if (field.multiple) {
    const chosen = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (v: string) =>
      onChange(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]);
    return (
      <Stack gap={4}>
        <Text size="sm" fw={500}>{field.label}</Text>
        {field.help && <Text size="xs" c="var(--mb-muted)">{field.help}</Text>}
        {items.map((o) => (
          <Checkbox key={o.value} label={optionLabel(o)} checked={chosen.includes(o.value)}
            disabled={o.disabled_reason !== null && !chosen.includes(o.value)} onChange={() => toggle(o.value)} />
        ))}
        {error && <Text size="xs" c="red">{error}</Text>}
      </Stack>
    );
  }
  const current = typeof value === "string" ? value : "";
  const blank = field.default === undefined || field.default === null;
  return (
    <NativeSelect label={field.label} description={field.help} error={error} value={current}
      onChange={(e) => onChange(e.currentTarget.value === "" ? undefined : e.currentTarget.value)}
      data={[...(blank ? [{ value: "", label: "—" }] : []),
        ...items.map((o) => ({ value: o.value, label: optionLabel(o), disabled: o.disabled_reason !== null }))]} />
  );
}
