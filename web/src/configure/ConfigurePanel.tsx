import { Alert, Button, Group, Stack, Text, Title } from "@mantine/core";
import { useMemo, useState, type ComponentType } from "react";
import { useFamilies, useOptions } from "../api/queries";
import type { CardConfigJson, Condition, FieldDescriptor, StateContext, Widget } from "../api/types";
import { compareGroup, evaluate, getPath, isSet, setPath, visibleFields, type ScenarioKinds } from "./conditions";
import { normalize } from "./draft";
import { useDraftValidation } from "./useDraftValidation";
import { ChoiceField } from "./widgets/ChoiceField";
import { CutBuilder } from "./widgets/CutBuilder";
import { ElectionPicker } from "./widgets/ElectionPicker";
import { FilterList } from "./widgets/FilterList";
import { NumberField, TextField, ToggleField } from "./widgets/SimpleFields";
import type { WidgetProps } from "./widgets/types";

const WIDGETS: Record<Exclude<Widget, "slot">, ComponentType<WidgetProps>> = {
  text: TextField, number: NumberField, toggle: ToggleField, choice: ChoiceField, scenario_picker: ChoiceField,
  metric_picker: ChoiceField, party_picker: ChoiceField, election_picker: ElectionPicker, cut_builder: CutBuilder,
  filter_list: FilterList,
};

const SHAKTI: Condition = { op: "all", of: [
  { op: "kind_of", path: "comparison.target.scenario", kind: "party" },
  { op: "kind_of", path: "comparison.reference.scenario", kind: "opinion" },
] };

interface Props {
  family: string;
  initial: CardConfigJson;
  ctx: StateContext;
  onApply(card: CardConfigJson): void;
  onCancel(): void;
}

/**
 * Configure one card from its family's descriptor (spec 6). It holds no card rules: what shows comes
 * from the descriptor's conditions, what is valid from POST /cards/validate. Nothing runs until Apply.
 */
export function ConfigurePanel({ family, initial, ctx, onApply, onCancel }: Props) {
  const families = useFamilies();
  const descriptor = families.data?.find((d) => d.family === family);
  const [draft, setDraft] = useState<CardConfigJson>(initial);
  const [more, setMore] = useState(false);
  const scenarios = useOptions("scenarios", { kind: "any" }, draft, ctx);
  const kinds: ScenarioKinds = useMemo(
    () => Object.fromEntries((scenarios.data ?? []).map((o) => [o.value, o.recalled ? "recalled" : o.kind ?? ""])),
    [scenarios.data],
  );
  // Prune only once the scenario kinds are known; earlier, kind conditions would wrongly hide fields and drop their values.
  const ready = descriptor !== undefined && scenarios.isSuccess;
  const normalized = useMemo(() => (ready ? normalize(descriptor, draft, kinds) : null), [ready, descriptor, draft, kinds]);
  const validation = useDraftValidation(normalized, ctx);

  if (families.isError) return <Alert color="red" role="alert">The card settings could not be loaded</Alert>;
  if (!ready || normalized === null) return <Text size="sm">Loading…</Text>;

  const shown = visibleFields(descriptor, normalized, kinds);
  const visiblePaths = new Set(shown.map((f) => f.path));
  const errors = validation.data?.errors ?? [];
  const errorAt = (path: string) => errors.find((e) => e.path === path)?.message;
  const stray = errors.filter((e) => !visiblePaths.has(e.path));
  const set = (path: string) => (value: unknown) => setDraft((d) => setPath(d, path, value) as CardConfigJson);
  const render = (f: FieldDescriptor) => {
    if (f.widget === "slot") return null; // no family needs a custom slot yet
    const Widget = WIDGETS[f.widget];
    return <Widget key={f.path} field={f} value={getPath(normalized, f.path)} onChange={set(f.path)}
      draft={normalized} ctx={ctx} error={errorAt(f.path)} />;
  };
  const primary = shown.filter((f) => f.tier === "primary");
  const rest = shown.filter((f) => f.tier === "more");
  const shakti = visiblePaths.has("comparison.reference.scenario") && evaluate(SHAKTI, normalized, kinds);
  const canApply = validation.upToDate && validation.data?.valid === true;
  const inCompare = compareGroup(primary);
  const setCount = rest.filter((f) => isSet(getPath(normalized, f.path))).length;
  const problems = errors.length;

  return (
    <Stack gap="sm">
      <div>
        <Title order={3}>{descriptor.label}</Title>
        <Text size="sm" c="var(--mb-muted)">{descriptor.description}</Text>
      </div>
      {primary.map((f) => {
        if (!inCompare.includes(f)) return render(f);
        if (f !== inCompare[0]) return null; // the block is drawn once, at its first field
        return (
          <div key="compare" data-testid="compare-block" style={{
            padding: "10px 14px 14px", borderRadius: 12, background: "var(--mb-primary-soft)", border: "1px solid var(--mb-soft-line)",
          }}>
            <Text size="xs" fw={600} c="var(--mb-ink)" mb={6}>Comparing two questions</Text>
            <Stack gap="sm">
              {inCompare.map(render)}
              {shakti && <Text size="sm" fw={600}>Shakti comparison</Text>}
            </Stack>
          </div>
        );
      })}
      {shakti && inCompare.length === 0 && <Text size="sm" fw={600}>Shakti comparison</Text>}
      {rest.length > 0 && (
        <Group gap={8} style={{ alignSelf: "flex-start" }}>
          <Button variant="subtle" size="xs" onClick={() => setMore((m) => !m)}>
            {more ? "Fewer options" : "More options"}
          </Button>
          <span data-testid="more-count" style={{
            fontSize: 11.5, padding: "1px 8px", borderRadius: 10, background: setCount > 0 ? "var(--mb-primary-soft)" : "var(--mb-header-bg)",
            color: setCount > 0 ? "var(--mb-ink)" : "var(--mb-muted)",
          }}>{setCount} set</span>
        </Group>
      )}
      {more && rest.map(render)}
      {(stray.length > 0 || (validation.data?.unavailable.length ?? 0) > 0) && (
        <Alert color="orange" title="This card cannot run yet">
          {stray.map((e) => <Text key={`${e.path}:${e.message}`} size="sm">{e.message}</Text>)}
          {validation.data?.unavailable.map((u) => <Text key={u.reason} size="sm">{u.reason}</Text>)}
        </Alert>
      )}
      {validation.data?.notes.map((n) => <Text key={n} size="sm" c="var(--mb-muted)">{n}</Text>)}
      <Group justify="flex-end" align="center">
        <Text size="xs" c="var(--mb-muted)" mr="auto" role="status">
          {canApply ? "Ready to apply" : problems > 0 ? `${problems} thing${problems === 1 ? "" : "s"} to fix` : "Checking…"}
        </Text>
        <Button variant="default" onClick={onCancel}>Cancel</Button>
        <Button disabled={!canApply} onClick={() => onApply(normalized)}>Apply</Button>
      </Group>
    </Stack>
  );
}
