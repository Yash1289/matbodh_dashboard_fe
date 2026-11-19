import { Checkbox, NumberInput, TextInput } from "@mantine/core";
import type { WidgetProps } from "./types";

export function TextField({ field, value, onChange, error }: WidgetProps) {
  return (
    <TextInput label={field.label} description={field.help} error={error} value={typeof value === "string" ? value : ""}
      maxLength={field.limits?.max_length} onChange={(e) => onChange(e.currentTarget.value)} />
  );
}

export function NumberField({ field, value, onChange, error }: WidgetProps) {
  return (
    <NumberInput label={field.label} description={field.help} error={error} allowDecimal={false}
      min={field.limits?.min} max={field.limits?.max} value={typeof value === "number" ? value : ""}
      onChange={(v) => onChange(v === "" ? undefined : Number(v))} />
  );
}

export function ToggleField({ field, value, onChange, error }: WidgetProps) {
  return (
    <Checkbox label={field.label} description={field.help} error={error} checked={value === true}
      onChange={(e) => onChange(e.currentTarget.checked)} />
  );
}
