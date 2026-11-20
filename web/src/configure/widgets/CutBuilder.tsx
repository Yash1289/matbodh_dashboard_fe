import { Button, Checkbox, Group, NativeSelect, Stack, Text } from "@mantine/core";
import { Fragment } from "react";
import { useOptions } from "../../api/queries";
import { asParams, selectData, type WidgetProps } from "./types";

const name = (cut: string[]) => (cut.length === 0 ? "Overall" : cut.join(" × "));

/** Independent cuts (each its own table); fields within one cut are crossed. The empty cut is Overall. */
export function CutBuilder({ field, value, onChange, draft, ctx, error }: WidgetProps) {
  const options = useOptions(field.options?.source ?? "fields", asParams(field), draft, ctx);
  const cuts = Array.isArray(value) ? (value as string[][]) : [];
  const fields = options.data ?? [];
  const overall = cuts.some((c) => c.length === 0);
  const pickable = fields.filter((o) => o.disabled_reason === null);
  const scopeOf = (name: string) => fields.find((o) => o.value === name)?.scope ?? null;
  const set = (next: string[][]) => onChange(next);

  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>{field.label}</Text>
      {field.help && <Text size="xs" c="var(--mb-muted)">{field.help}</Text>}
      <Checkbox label="Overall" checked={overall}
        onChange={() => set(overall ? cuts.filter((c) => c.length > 0) : [[], ...cuts])} />
      {cuts.map((cut, i) => (cut.length === 0 ? null : (
        <Fragment key={name(cut)}>
        <Group gap="xs" wrap="nowrap">
          <Text size="sm" style={{ flex: 1 }}>{name(cut)}</Text>
          <NativeSelect aria-label={`Cross ${name(cut)} with`} value=""
            onChange={(e) => e.currentTarget.value && set(cuts.map((c, j) => (j === i ? [...c, e.currentTarget.value] : c)))}
            data={[{ value: "", label: "Cross with…" }, ...selectData(pickable.filter((o) => !cut.includes(o.value)))]} />
          <Button size="xs" variant="subtle" aria-label={`Remove cut ${name(cut)}`}
            onClick={() => set(cuts.filter((_, j) => j !== i))}>Remove</Button>
        </Group>
        {cut.length >= 2 && scopeOf(cut[0]) === "seat" && (
          <Text size="xs" c="var(--mb-ink)" role="note">
            {cut[0]} is a seat field: the card shows one {cut[0].replace(/_/g, " ")} at a time, with the other fields for it.
          </Text>
        )}
        </Fragment>
      )))}
      <NativeSelect label="Add a cut" value=""
        onChange={(e) => e.currentTarget.value && set([...cuts, [e.currentTarget.value]])}
        data={[{ value: "", label: "Choose a field…" }, ...selectData(fields)]} />
      {error && <Text size="xs" c="red">{error}</Text>}
    </Stack>
  );
}
