import { Button, Checkbox, Group, NativeSelect, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { getRun, startValues } from "../../api/client";
import { useOptions } from "../../api/queries";
import type { CardConfigJson, CardFilterConfig, FilterValues, StateContext } from "../../api/types";
import { asParams, optionLabel, type WidgetProps } from "./types";

const POLL_MS = 1500;
const MISSING = "not in the selected rounds";

/** The values of one field among the respondents of the card's scenario (an engine run, cached). */
function useFilterValues(field: string, draft: CardConfigJson, ctx: StateContext) {
  const scenario = draft.scenarios?.[0] ?? draft.comparison?.target?.scenario ?? null;
  const pipeRounds = draft.pipe_rounds ?? null;
  const started = useQuery({
    queryKey: ["filter-values-run", field, scenario, pipeRounds, ctx],
    queryFn: () => startValues(field, scenario, ctx, pipeRounds),
    staleTime: Infinity,
  });
  const runId = started.data ?? null;
  const run = useQuery({
    queryKey: ["run", runId],
    queryFn: () => getRun(runId as string),
    enabled: runId !== null,
    staleTime: Infinity,
    refetchInterval: (q) => (q.state.data?.state === "running" ? POLL_MS : false),
  });
  const done = run.data?.state === "done" ? (run.data.result as unknown as FilterValues) : null;
  const failed = run.data !== undefined && (run.data.state === "failed" || run.data.state === "partial")
    ? Object.values(run.data.errors).map((e) => e.message).join("; ") || "The values could not be loaded"
    : null;
  const requestError = started.error ?? run.error;
  return { values: done?.values ?? null, error: failed ?? (requestError ? "The values could not be loaded" : null) };
}

function FilterRow({ filter, onChange, onRemove, draft, ctx }: {
  filter: CardFilterConfig; onChange(f: CardFilterConfig): void; onRemove(): void; draft: CardConfigJson; ctx: StateContext;
}) {
  const { values, error } = useFilterValues(filter.field, draft, ctx);
  const missing = values === null ? (error !== null ? filter.values : []) : filter.values.filter((v) => !values.includes(v));
  const toggle = (v: string) => onChange({
    ...filter, values: filter.values.includes(v) ? filter.values.filter((x) => x !== v) : [...filter.values, v],
  });
  return (
    <Stack gap={4}>
      <Group gap="xs" wrap="nowrap">
        <NativeSelect aria-label={filter.field} value={filter.operator}
          onChange={(e) => onChange({ ...filter, operator: e.currentTarget.value as "in" | "not_in" })}
          data={[{ value: "in", label: `${filter.field} is one of` }, { value: "not_in", label: `${filter.field} is not one of` }]} />
        <Button size="xs" variant="subtle" aria-label={`Remove filter ${filter.field}`} onClick={onRemove}>Remove</Button>
      </Group>
      {values === null && error === null && <Text size="xs" c="var(--mb-muted)">Loading values…</Text>}
      {error !== null && <Text size="xs" c="red">{error}</Text>}
      {(values ?? []).map((v) => (
        <Checkbox key={v} label={v} checked={filter.values.includes(v)} onChange={() => toggle(v)} />
      ))}
      {missing.map((v) => (
        <Checkbox key={v} label={values === null ? v : `${v} (${MISSING})`} checked onChange={() => toggle(v)} />
      ))}
    </Stack>
  );
}

/** Several filters, AND-combined; each picks values that exist in the rounds the card reads. */
export function FilterList({ field, value, onChange, draft, ctx, error }: WidgetProps) {
  const fields = useOptions(field.options?.source ?? "fields", asParams(field), draft, ctx);
  const filters = Array.isArray(value) ? (value as CardFilterConfig[]) : [];
  const used = new Set(filters.map((f) => f.field));
  const set = (next: CardFilterConfig[]) => onChange(next);
  return (
    <Stack gap={8}>
      <Text size="sm" fw={500}>{field.label}</Text>
      {filters.map((f, i) => (
        <FilterRow key={f.field} filter={f} draft={draft} ctx={ctx}
          onChange={(next) => set(filters.map((x, j) => (j === i ? next : x)))}
          onRemove={() => set(filters.filter((_, j) => j !== i))} />
      ))}
      <NativeSelect label="Add filter" value=""
        onChange={(e) => e.currentTarget.value && set([...filters, { field: e.currentTarget.value, operator: "in", values: [] }])}
        data={[{ value: "", label: "Choose a field…" },
          ...(fields.data ?? []).filter((o) => !used.has(o.value))
            .map((o) => ({ value: o.value, label: optionLabel(o), disabled: o.disabled_reason !== null }))]} />
      {error && <Text size="xs" c="red">{error}</Text>}
    </Stack>
  );
}
