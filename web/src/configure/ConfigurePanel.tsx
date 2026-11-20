import { Alert, Button, Text } from "@mantine/core";
import { useMemo, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { useFamilies, useOptions } from "../api/queries";
import type { CardConfigJson, Condition, FieldDescriptor, StateContext, Widget } from "../api/types";
import { compareGroup, evaluate, getPath, isSet, setPath, visibleFields, type ScenarioKinds } from "./conditions";
import { normalize } from "./draft";
import { describeDraft } from "./summary";
import { useDraftValidation } from "./useDraftValidation";
import styles from "./ConfigurePanel.module.css";
import { Well } from "./widgets/Well";
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
  const body = useRef<HTMLDivElement>(null);
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
  const summary = describeDraft(normalized, ctx);
  const problems = errors.length + (validation.data?.unavailable.length ?? 0);

  /** The status link: take the analyst to the first thing that blocks Apply. */
  const goToProblem = () => {
    const field = body.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (field ?? body.current?.querySelector<HTMLElement>('[data-problems]'))?.scrollIntoView({ block: "center" });
    field?.focus();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canApply) onApply(normalized);
  };

  const titleField = primary.find((f) => f.path === "title");
  const SPLIT = new Set(["cut_builder", "filter_list"]);
  const answer = primary.filter((f) => f !== titleField && !SPLIT.has(f.widget));
  const split = primary.filter((f) => SPLIT.has(f.widget));
  /** A field that is its own framed well (a long list, the cuts, the filters); the others are property rows. */
  const isWell = (f: FieldDescriptor) =>
    SPLIT.has(f.widget) || (f.multiple === true && ["choice", "scenario_picker", "metric_picker", "party_picker"].includes(f.widget));
  const compareWell = (
    <div key="compare" className="mb-reveal" data-testid="compare-block">
      <Well title="Comparing two questions">
        {inCompare.map(render)}
        {shakti && <p className={styles.shakti}>Shakti comparison</p>}
      </Well>
    </div>
  );
  /** Wells stand alone; consecutive property rows share one "Settings" well; the comparison is drawn once, at its first field. */
  const arrange = (fields: FieldDescriptor[], label: string) => {
    const out: ReactNode[] = [];
    let rows: FieldDescriptor[] = [];
    const flush = () => {
      if (rows.length > 0) out.push(<Well key={`${label}:${rows[0].path}`} title="Settings">{rows.map(render)}</Well>);
      rows = [];
    };
    for (const f of fields) {
      if (inCompare.includes(f)) {
        if (f === inCompare[0]) { flush(); out.push(compareWell); }
      } else if (isWell(f)) { flush(); out.push(render(f)); } else rows.push(f);
    }
    flush();
    return out;
  };

  return (
    <form className={styles.panel} onSubmit={submit} noValidate>
      <div className={styles.body} ref={body}>
        <div>
          <Text size="sm" c="var(--mb-muted)">{descriptor.description}</Text>
        </div>
        {titleField && <div className={styles.titleCard}>{render(titleField)}</div>}
        <div className={styles.columns} data-split={split.length > 0 && answer.length > 0}>
          <div className={styles.group} role="group" aria-labelledby="cfg-answer">
            {split.length > 0 && <p className={styles.groupLabel} id="cfg-answer">What to show</p>}
            {arrange(answer, "show")}
            {shakti && inCompare.length === 0 && <p className={styles.shakti}>Shakti comparison</p>}
          </div>
          {split.length > 0 && (
            <div className={styles.group} role="group" aria-labelledby="cfg-split">
              <p className={styles.groupLabel} id="cfg-split">How to split it</p>
              {arrange(split, "split")}
            </div>
          )}
        </div>
        {rest.length > 0 && (
          <section className={styles.more}>
            <div className={styles.moreBar}>
              <Button variant="subtle" size="xs" onClick={() => setMore((m) => !m)} aria-expanded={more}>
                {more ? "Fewer options" : "More options"}
              </Button>
              <span data-testid="more-count" className={styles.moreCount} data-set={setCount > 0}>{setCount} set</span>
            </div>
            {more && <div className={`mb-reveal ${styles.moreGrid}`}>{arrange(rest, "more")}</div>}
          </section>
        )}
        {(stray.length > 0 || (validation.data?.unavailable.length ?? 0) > 0) && (
          <Alert color="orange" variant="light" title="This card cannot run yet" data-problems styles={{ title: { color: "var(--mb-text)" }, message: { color: "var(--mb-text)" } }}>
            {stray.map((e) => <Text key={`${e.path}:${e.message}`} size="sm">{e.message}</Text>)}
            {validation.data?.unavailable.map((u) => <Text key={u.reason} size="sm">{u.reason}</Text>)}
          </Alert>
        )}
        {validation.data?.notes.map((n) => <Text key={n} size="sm" c="var(--mb-muted)">{n}</Text>)}
      </div>
      {summary !== null && <p className={styles.summary} data-testid="draft-summary">{summary}</p>}
      <div className={styles.footer}>
        <span className={styles.status} role="status">
          {canApply ? "Ready to apply" : problems > 0
            ? <button type="button" className={styles.fix} onClick={goToProblem}>{`${problems} thing${problems === 1 ? "" : "s"} to fix`}</button>
            : "Checking…"}
        </span>
        <Button variant="default" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={!canApply}>Apply</Button>
      </div>
    </form>
  );
}
