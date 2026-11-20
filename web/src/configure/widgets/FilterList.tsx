import { Button, Checkbox, NativeSelect } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, fetchDistinctValues, getRun, startValues } from "../../api/client";
import { useOptions } from "../../api/queries";
import type { CardConfigJson, CardFilterConfig, FilterValues, StateContext } from "../../api/types";
import { asParams, optionLabel, type WidgetProps } from "./types";
import { Well } from "./Well";
import styles from "./wells.module.css";

const POLL_MS = 1500;
const MISSING = "not in the selected rounds";
/** A field's values are an engine run over every selected round: a first load can take a minute, so say so after a few seconds. */
export const SLOW_MS = 6000;

function useSlow(waiting: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!waiting) return undefined;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  return slow;
}

/**
 * The values of one field. A lookup answers first (the reporting mapping, else distinct answers) for the rounds the card's
 * mode reads; only a field the lookup cannot list (it is not in the response table) falls back to an engine run, polled.
 */
function useFilterValues(field: string, draft: CardConfigJson, ctx: StateContext) {
  const scenario = draft.scenarios?.[0] ?? draft.comparison?.target?.scenario ?? null;
  const pipeRounds = draft.pipe_rounds ?? null;
  const mode = draft.comparison?.mode ?? "standalone";
  const lookup = useQuery({
    queryKey: ["filter-values-distinct", field, mode, pipeRounds, ctx],
    queryFn: () => fetchDistinctValues(field, mode, ctx, pipeRounds),
    staleTime: Infinity,
  });
  const viaEngine = lookup.data?.source === "engine";
  const started = useQuery({
    queryKey: ["filter-values-run", field, scenario, pipeRounds, ctx],
    queryFn: () => startValues(field, scenario, ctx, pipeRounds),
    enabled: viaEngine,
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
  const requestError = lookup.error ?? started.error ?? run.error;
  // The API says why a field cannot be listed (for example, it is missing from one of the rounds): show that, not a generic line.
  const reason = requestError instanceof ApiError ? requestError.errors[0] : undefined;
  const values = lookup.data !== undefined && !viaEngine ? lookup.data.values : done?.values ?? null;
  return { values, error: failed ?? (requestError ? reason ?? "The values could not be loaded" : null) };
}

function FilterRow({ filter, onChange, onRemove, draft, ctx }: {
  filter: CardFilterConfig; onChange(f: CardFilterConfig): void; onRemove(): void; draft: CardConfigJson; ctx: StateContext;
}) {
  const { values, error } = useFilterValues(filter.field, draft, ctx);
  const slow = useSlow(values === null && error === null);
  const missing = values === null ? (error !== null ? filter.values : []) : filter.values.filter((v) => !values.includes(v));
  const toggle = (v: string) => onChange({
    ...filter, values: filter.values.includes(v) ? filter.values.filter((x) => x !== v) : [...filter.values, v],
  });
  return (
    <div className={styles.item}>
      <div className={styles.itemHead}>
        <NativeSelect size="xs" aria-label={filter.field} value={filter.operator} style={{ flex: 1 }}
          onChange={(e) => onChange({ ...filter, operator: e.currentTarget.value as "in" | "not_in" })}
          data={[{ value: "in", label: `${filter.field} is one of` }, { value: "not_in", label: `${filter.field} is not one of` }]} />
        <Button size="compact-sm" variant="subtle" color="gray" aria-label={`Remove filter ${filter.field}`} onClick={onRemove}>Remove</Button>
      </div>
      {values === null && error === null && (
        <p className={styles.none} role="status">
          {slow ? "Still loading. A field seen for the first time can take about a minute; later loads are instant." : "Loading values…"}
        </p>
      )}
      {error !== null && <p className={styles.error}>{error}</p>}
      <div className={styles.options}>
        {(values ?? []).map((v) => (
          <div key={v} className={styles.option} data-selected={filter.values.includes(v)}>
            <Checkbox size="sm" label={v} checked={filter.values.includes(v)} onChange={() => toggle(v)} />
          </div>
        ))}
        {missing.map((v) => (
          <div key={v} className={styles.option} data-selected="true">
            <Checkbox size="sm" label={values === null ? v : `${v} (${MISSING})`} checked onChange={() => toggle(v)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Several filters, AND-combined; each picks values that exist in the rounds the card reads. */
export function FilterList({ field, value, onChange, draft, ctx, error }: WidgetProps) {
  const fields = useOptions(field.options?.source ?? "fields", asParams(field), draft, ctx);
  const filters = Array.isArray(value) ? (value as CardFilterConfig[]) : [];
  const used = new Set(filters.map((f) => f.field));
  const set = (next: CardFilterConfig[]) => onChange(next);
  return (
    <Well title={field.label} hint={field.help} badge={filters.length > 0 ? `${filters.length} filter${filters.length === 1 ? "" : "s"}` : null}>
      {filters.map((f, i) => (
        <FilterRow key={f.field} filter={f} draft={draft} ctx={ctx}
          onChange={(next) => set(filters.map((x, j) => (j === i ? next : x)))}
          onRemove={() => set(filters.filter((_, j) => j !== i))} />
      ))}
      <NativeSelect size="sm" label="Add filter" value=""
        onChange={(e) => e.currentTarget.value && set([...filters, { field: e.currentTarget.value, operator: "in", values: [] }])}
        data={[{ value: "", label: "Choose a field…" },
          ...(fields.data ?? []).filter((o) => !used.has(o.value))
            .map((o) => ({ value: o.value, label: optionLabel(o), disabled: o.disabled_reason !== null }))]} />
      {error && <p className={styles.error}>{error}</p>}
    </Well>
  );
}
