import { Alert, Button, Radio, Select, Skeleton, Stack, Text } from "@mantine/core";
import { useEffect, useId, useState } from "react";
import { useStates, useSurveys } from "../api/queries";
import type { Level, StateContext, SurveyRound } from "../api/types";
import styles from "./ContextDialog.module.css";

type Draft = Omit<StateContext, "level"> & { level: Level | null };
type VersionMode = StateContext["version_mode"];

const EMPTY: Draft = {
  state: "", level: null, rounds: [], compare_round: null, anchor_round: null,
  version_mode: "extrapolated", geo_scope: "state",
};

const LEVEL_LABEL: Record<Level, string> = {
  ac: "Assembly constituency (AC)", pc: "Parliamentary constituency (PC)", zone: "Zone", state: "Statewide",
};
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : DATE.format(date);
}

function roundMetadata(round: SurveyRound, mode: VersionMode, seatLevel: boolean) {
  const extrapolated = mode === "extrapolated" && round.versions.extrapolated;
  const version = extrapolated || round.versions.normal;
  if (!version) return "No Normal dataset";
  const start = formatDate(version.start_date);
  const end = formatDate(version.end_date);
  const fieldwork = start && end ? (start === end ? start : `${start} – ${end}`) : start || end;
  const seats = seatLevel && typeof version.seats === "number" ? `${version.seats} seats` : null;
  return [fieldwork, seats, extrapolated ? "Extrapolated" : "Normal"].filter(Boolean).join(" · ");
}

interface Props {
  context: StateContext | null;
  planError: string | null;
  onCancel(): void;
  onApply(context: StateContext): void;
}

export function ContextDialog({ context, planError, onCancel, onApply }: Props) {
  const [draft, setDraft] = useState<Draft>(context ?? EMPTY);
  const roundId = useId();
  const states = useStates();
  const surveys = useSurveys(draft.state || null);
  const soleState = states.data?.length === 1 ? states.data[0] : null;

  useEffect(() => {
    if (soleState) setDraft((current) => current.state ? current : { ...current, state: soleState });
  }, [soleState]);

  const levels = (Object.keys(surveys.data?.levels ?? {}) as Level[])
    .filter((level) => surveys.data?.levels[level]?.some((group) => group.rounds.length))
    .map((level) => ({ value: level, label: LEVEL_LABEL[level] }));
  const groups = (draft.level ? surveys.data?.levels[draft.level] : undefined) ?? [];
  const selected = groups.flatMap((group) => group.rounds).filter((round) => draft.rounds.includes(round.base_name));
  const names = selected.map((round) => round.base_name);
  const latest = names[names.length - 1] ?? null;
  const explicitAnchor = draft.anchor_round && names.includes(draft.anchor_round) ? draft.anchor_round : null;
  const anchor = explicitAnchor ?? latest;
  const compare = draft.compare_round && names.includes(draft.compare_round) && draft.compare_round !== anchor
    ? draft.compare_round : null;
  const options = names.map((name) => ({ value: name, label: name }));
  const multipleSeries = groups.filter((group) => group.rounds.some((round) => names.includes(round.base_name))).length > 1;
  const seatLevel = draft.level === "ac" || draft.level === "pc";
  const missingNormal = selected.filter((round) => !round.versions.normal).map((round) => round.base_name);
  const matched = seatLevel && draft.version_mode === "matched";
  const invalidCoverage = matched && missingNormal.length > 0;
  const canApply = !states.isError && !surveys.isError && draft.level !== null && selected.length > 0 && !invalidCoverage;
  const selectionCount = `${selected.length} ${selected.length === 1 ? "round" : "rounds"} selected`;

  const toggleRound = (name: string, checked: boolean) => {
    const next = checked ? [...names, name] : names.filter((value) => value !== name);
    const ordered = groups.flatMap((group) => group.rounds.map((round) => round.base_name))
      .filter((value) => next.includes(value));
    const keepAnchor = explicitAnchor && ordered.includes(explicitAnchor) ? explicitAnchor : null;
    const effectiveAnchor = keepAnchor ?? ordered[ordered.length - 1];
    const keepCompare = compare && ordered.includes(compare) && compare !== effectiveAnchor ? compare : null;
    setDraft({ ...draft, rounds: ordered, anchor_round: keepAnchor, compare_round: keepCompare });
  };

  const roundPrompt = !draft.state ? "Choose a state to see its surveys."
    : levels.length === 0 ? "No survey rounds are available for this state."
    : "Choose a survey level to see its rounds.";

  return (
    <>
      <div className={styles.scrollBody}>
        <Text className={styles.intro}>
          {context ? "Choose the survey rounds the dashboard should show." : "Choose a state, survey level and rounds to begin."}
        </Text>
        {planError && <Alert color="red" role="alert" mb="md">{planError}</Alert>}
        <div className={styles.filters}>
          <div>
            <Select label="State" placeholder={states.isPending ? "Loading states…" : "Choose a state"}
              data={states.data ?? []} value={draft.state || null} size="md" allowDeselect={false}
              disabled={states.isPending || states.isError}
              onChange={(state) => { if (state && state !== draft.state) setDraft({ ...EMPTY, state }); }} />
            {states.isError && <CatalogueError message="Could not load states." onRetry={() => void states.refetch()} />}
            {states.data?.length === 0 && <Text size="sm" c="var(--mb-muted)">No states are available.</Text>}
          </div>
          <div>
            <Select label="Survey level" placeholder={draft.state && surveys.isPending ? "Loading levels…" : "Choose a level"}
              data={levels} value={draft.level} size="md" disabled={levels.length === 0} allowDeselect={false}
              onChange={(level) => setDraft({ ...EMPTY, state: draft.state, level: level as Level | null })} />
            {surveys.isError && <CatalogueError message="Could not load the survey catalogue." onRetry={() => void surveys.refetch()} />}
          </div>
        </div>

        <div className={styles.columns}>
          <section aria-label="Survey rounds">
            <h3>Survey rounds</h3>
            <p className={styles.help}>Select the rounds you want to see in the dashboard.</p>
            {draft.state && surveys.isPending && <Skeleton height={76} mt="md" aria-label="Loading survey rounds" />}
            {!surveys.isError && !(draft.state && surveys.isPending) && groups.length === 0 && (
              <p className={styles.empty}>{roundPrompt}</p>
            )}
            {groups.map((group) => (
              <fieldset className={styles.roundGroup} key={group.group}>
                <legend>{group.group}</legend>
                {group.rounds.map((round) => {
                  const name = round.base_name;
                  const checked = names.includes(name);
                  const metadataId = roundId + "-" + encodeURIComponent(name);
                  const roleId = metadataId + "-role";
                  const role = name === anchor ? "Current round" : name === compare ? "Baseline" : null;
                  return (
                    <label className={styles.round} data-selected={checked} key={name}>
                      <input type="checkbox" checked={checked} aria-label={name}
                        aria-describedby={role ? metadataId + " " + roleId : metadataId}
                        onChange={(event) => toggleRound(name, event.currentTarget.checked)} />
                      <span className={styles.roundDetails}>
                        <strong>{round.label}</strong>
                        <span id={metadataId} className={styles.roundMetadata}>{roundMetadata(round, matched ? "matched" : "extrapolated", seatLevel)}</span>
                      </span>
                      {role && <span id={roleId} className={styles.roundRole}>{role}</span>}
                    </label>
                  );
                })}
              </fieldset>
            ))}
            {multipleSeries && <p className={styles.notice}>Different survey series. Check the series names before comparing rounds.</p>}
          </section>

          <section className={styles.comparison} aria-label="Comparison">
            <h3>Comparison</h3>
            <Stack gap={14}>
              <Select label="Current round" placeholder="Choose survey rounds first" size="md" disabled={!latest}
                data={latest ? [{ value: "latest", label: `Latest selected · ${latest}` }, ...options] : []}
                value={explicitAnchor ?? (latest ? "latest" : null)} allowDeselect={false}
                onChange={(value) => {
                  const anchorRound = value === "latest" ? null : value;
                  setDraft({ ...draft, anchor_round: anchorRound,
                    compare_round: compare === (anchorRound ?? latest) ? null : compare });
                }} />
              <Select label="Compare with" placeholder="Select at least two rounds" size="md" disabled={selected.length < 2}
                data={[{ value: "none", label: "No comparison" }, ...options.filter((option) => option.value !== anchor)]}
                value={selected.length < 2 ? null : compare ?? "none"} allowDeselect={false}
                onChange={(value) => setDraft({ ...draft, compare_round: value === "none" ? null : value })} />
              {compare && <div className={styles.preview} role="status">
                <span>Dashboard change</span>
                <strong>{anchor} − {compare}</strong>
              </div>}
            </Stack>
            {seatLevel && (
              <details className={styles.coverage} open={invalidCoverage || undefined}>
                <summary><strong>Seat coverage</strong><span>{matched ? "Matched seats only" : "Extrapolated"}</span></summary>
                <Radio.Group aria-label="Seat coverage" value={matched ? "matched" : "extrapolated"}
                  onChange={(value) => setDraft({ ...draft, version_mode: value === "matched" ? "matched" : "extrapolated" })}>
                  <Stack gap="sm" mt="sm">
                    <Radio value="extrapolated" label="Extrapolated" description="Uses Extrapolated where available, otherwise Normal. A round may include seats carried from earlier rounds." />
                    <Radio value="matched" label="Matched seats only" disabled={missingNormal.length > 0}
                      description="Uses Normal datasets. Geographic analyses use seats surveyed in every selected round." />
                  </Stack>
                </Radio.Group>
                {missingNormal.length > 0 && <p className={styles.notice} role={invalidCoverage ? "alert" : undefined}>
                  {missingNormal.length === 1 ? `${missingNormal[0]} has no Normal dataset.` : `No Normal datasets for ${missingNormal.join(", ")}.`}
                </p>}
              </details>
            )}
          </section>
        </div>
      </div>

      <footer className={styles.footer}>
        <Text size="sm" fw={600} role="status">{selectionCount}</Text>
        <div className={styles.actions}>
          <Button variant="default" onClick={onCancel}>Cancel</Button>
          <Button disabled={!canApply} onClick={() => {
            if (canApply && draft.level) onApply({
              ...draft, level: draft.level, rounds: names, anchor_round: explicitAnchor, compare_round: compare,
              version_mode: matched ? "matched" : "extrapolated",
            });
          }}>Apply selection</Button>
        </div>
      </footer>
    </>
  );
}

function CatalogueError({ message, onRetry }: { message: string; onRetry(): void }) {
  return <div className={styles.catalogueError}>
    <Text size="sm" c="var(--mb-loss)" role="alert">{message}</Text>
    <Button variant="subtle" size="compact-xs" onClick={onRetry}>Retry</Button>
  </div>;
}
