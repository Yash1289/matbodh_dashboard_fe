import { Button, Checkbox, Group, NativeSelect, Stack, Text } from "@mantine/core";
import { useOptions } from "../../api/queries";
import { asParams, optionLabel, type WidgetProps } from "./types";

const name = (cut: string[]) => (cut.length === 0 ? "Overall" : cut.join(" × "));

/** Independent cuts (each its own table); fields within one cut are crossed. The empty cut is Overall. */
export function CutBuilder({ field, value, onChange, draft, ctx, error }: WidgetProps) {
  const options = useOptions(field.options?.source ?? "fields", asParams(field), draft, ctx);
  const cuts = Array.isArray(value) ? (value as string[][]) : [];
  const fields = options.data ?? [];
  const overall = cuts.some((c) => c.length === 0);
  const pickable = fields.filter((o) => o.disabled_reason === null);
  const set = (next: string[][]) => onChange(next);

  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>{field.label}</Text>
      {field.help && <Text size="xs" c="var(--mb-muted)">{field.help}</Text>}
      <Checkbox label="Overall" checked={overall}
        onChange={() => set(overall ? cuts.filter((c) => c.length > 0) : [[], ...cuts])} />
      {cuts.map((cut, i) => (cut.length === 0 ? null : (
        <Group key={name(cut)} gap="xs" wrap="nowrap">
          <Text size="sm" style={{ flex: 1 }}>{name(cut)}</Text>
          <NativeSelect aria-label={`Cross ${name(cut)} with`} value=""
            onChange={(e) => e.currentTarget.value && set(cuts.map((c, j) => (j === i ? [...c, e.currentTarget.value] : c)))}
            data={[{ value: "", label: "Cross with…" },
              ...pickable.filter((o) => !cut.includes(o.value)).map((o) => ({ value: o.value, label: optionLabel(o) }))]} />
          <Button size="xs" variant="subtle" aria-label={`Remove cut ${name(cut)}`}
            onClick={() => set(cuts.filter((_, j) => j !== i))}>Remove</Button>
        </Group>
      )))}
      <NativeSelect label="Add a cut" value=""
        onChange={(e) => e.currentTarget.value && set([...cuts, [e.currentTarget.value]])}
        data={[{ value: "", label: "Choose a field…" },
          ...fields.map((o) => ({ value: o.value, label: optionLabel(o), disabled: o.disabled_reason !== null }))]} />
      {error && <Text size="xs" c="red">{error}</Text>}
    </Stack>
  );
}
