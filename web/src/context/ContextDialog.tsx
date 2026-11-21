import { Alert, Button, Radio, Select, Skeleton, Stack, Text, TextInput } from "@mantine/core";
import { useEffect, useId, useState } from "react";
import { useStates, useSurveys } from "../api/queries";
import type { Level, StateContext, SurveyRound } from "../api/types";
import styles from "./ContextDialog.module.css";

type Draft = StateContext;
type VersionMode = StateContext["version_mode"];

const EMPTY: Draft = {
  state: "", rounds: [], compare_round: null, anchor_round: null,
  version_mode: "extrapolated", geo_scope: "state",
};

const LEVEL_LABEL: Record<Level, string> = {
  ac: "Assembly constituency (AC)", pc: "Parliamentary constituency (PC)", zone: "Zone", state: "Statewide",
};
const LEVELS: readonly Level[] = ["ac", "pc", "zone", "state"];
const LEVEL_TAG: Record<Level, string> = { ac: "AC", pc: "PC", zone: "Zone", state: "Statewide" };
/** A list this long gets a search box. */
const SEARCH_FROM = 8;
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
  /** "step" is the first screen: no Cancel, and the action reads Continue. */
  variant?: "dialog" | "step";
  context: StateContext | null;
  planError: string | null;
  onCancel(): void;
  onApply(context: StateContext): void;
  /** The first step reports how far along the choice is (0 to 3: where, rounds, ready), for its progress list. */
  onProgress?(done: number): void;
}

export function ContextDialog({ variant = "dialog", context, planError, onCancel, onApply, onProgress }: Props) {
  const step = variant === "step";
  const [draft, setDraft] = useState<Draft>(context ?? EMPTY);
  const roundId = useId();
  // The level is only a filter on the list: what is chosen at any level stays chosen.
  const [levelPick, setLevelPick] = useState<Level | null>(null);
  const [search, setSearch] = useState("");
  const states = useStates();
  const surveys = useSurveys(draft.state || null);
  const soleState = states.data?.length === 1 ? states.data[0] : null;

  useEffect(() => {
    if (soleState) setDraft((current) => current.state ? current : { ...current, state: soleState });
  }, [soleState]);

  // Every level the state has rounds at, each with its series groups; a round's level is the section it is in.
  const sections = LEVELS.map((level) => ({ level, groups: (surveys.data?.levels[level] ?? []).filter((group) => group.rounds.length) }))
    .filter((section) => section.groups.length > 0);
  const groups = sections.flatMap((section) => section.groups);
  const levelOf = new Map(sections.flatMap((section) => section.groups.flatMap((group) => group.rounds.map((round) => [round.base_name, section.level] as const))));
  const selected = groups.flatMap((group) => group.rounds).filter((round) => draft.rounds.includes(round.base_name));
  const names = selected.map((round) => round.base_name);
  const mixedLevels = new Set(names.map((name) => levelOf.get(name))).size > 1;
  // One level: the catalogue order. Several: order of fieldwork, since the groups are listed level by level.
  const startOf = (round: SurveyRound) => (round.versions.normal ?? round.versions.extrapolated)?.start_date ?? "";
  const byFieldwork = mixedLevels ? [...selected].sort((a, b) => startOf(a).localeCompare(startOf(b))) : selected;
  const latest = byFieldwork.length > 0 ? byFieldwork[byFieldwork.length - 1].base_name : null;
  const explicitAnchor = draft.anchor_round && names.includes(draft.anchor_round) ? draft.anchor_round : null;
  const anchor = explicitAnchor ?? latest;
  const compare = draft.compare_round && names.includes(draft.compare_round) && draft.compare_round !== anchor
    ? draft.compare_round : null;
  const options = names.map((name) => ({ value: name, label: name }));
  const multipleSeries = groups.filter((group) => group.rounds.some((round) => names.includes(round.base_name))).length > 1;
  const isSeatLevel = (name: string) => levelOf.get(name) === "ac" || levelOf.get(name) === "pc";
  const seatLevel = names.some(isSeatLevel);
  const missingNormal = selected.filter((round) => !round.versions.normal).map((round) => round.base_name);
  // Zone and statewide rounds only have a Normal dataset and no matched mode.
  const noMatched = names.filter((name) => !isSeatLevel(name));
  const matched = seatLevel && draft.version_mode === "matched";
  const invalidCoverage = matched && (missingNormal.length > 0 || noMatched.length > 0);
  const canApply = !states.isError && !surveys.isError && selected.length > 0 && !invalidCoverage;
  const selectionCount = `${selected.length} ${selected.length === 1 ? "round" : "rounds"} selected`;
  const status = step && selected.length === 0 ? "Choose at least one round to continue." : selectionCount;

  const done = (draft.state ? 1 : 0) + (selected.length > 0 ? 1 : 0) + (canApply ? 1 : 0);
  useEffect(() => { onProgress?.(done); }, [done, onProgress]);
  const Heading = step ? "h2" : "h3";

  const toggleRound = (name: string, checked: boolean) => {
    const next = checked ? [...names, name] : names.filter((value) => value !== name);
    const ordered = groups.flatMap((group) => group.rounds.map((round) => round.base_name))
      .filter((value) => next.includes(value));
    const keepAnchor = explicitAnchor && ordered.includes(explicitAnchor) ? explicitAnchor : null;
    const effectiveAnchor = keepAnchor ?? ordered[ordered.length - 1];
    const keepCompare = compare && ordered.includes(compare) && compare !== effectiveAnchor ? compare : null;
    setDraft({ ...draft, rounds: ordered, anchor_round: keepAnchor, compare_round: keepCompare });
  };

  const level = levelPick && sections.some((section) => section.level === levelPick) ? levelPick : sections[0]?.level ?? null;
  const countAt = (at: Level) => (sections.find((section) => section.level === at)?.groups ?? [])
    .flatMap((group) => group.rounds).filter((round) => names.includes(round.base_name)).length;
  const levelData = sections.map((section) => {
    const n = countAt(section.level);
    return { value: section.level, label: n > 0 ? `${LEVEL_LABEL[section.level]} · ${n} selected` : LEVEL_LABEL[section.level] };
  });
  const needle = search.trim().toLowerCase();
  const visible = sections.filter((section) => section.level === level).map((section) => ({
    ...section,
    groups: section.groups
      .map((group) => ({ ...group, rounds: group.rounds.filter((round) => !needle
        || round.label.toLowerCase().includes(needle) || round.base_name.toLowerCase().includes(needle)) }))
      .filter((group) => group.rounds.length > 0),
  }));
  const levelRoundCount = (sections.find((section) => section.level === level)?.groups ?? [])
    .reduce((total, group) => total + group.rounds.length, 0);
  const roundPrompt = !draft.state ? "Choose a state to see its surveys."
    : sections.length === 0 ? "No survey rounds are available for this state."
    : "Choose a state to see its surveys.";

  return (
    <>
      <div className={styles.scrollBody}>
        {!step && (
          <Text className={styles.intro}>
            {context ? "Choose the survey rounds the dashboard should show." : "Choose a state and survey rounds to begin."}
          </Text>
        )}
        {planError && <Alert color="red" role="alert" mb="md">{planError}</Alert>}
        <div className={styles.filters}>
          <div>
            <Select label="State" placeholder={states.isPending ? "Loading states…" : "Choose a state"}
              data={states.data ?? []} value={draft.state || null} size="md" allowDeselect={false}
              disabled={states.isPending || states.isError}
              onChange={(state) => { if (state && state !== draft.state) { setDraft({ ...EMPTY, state }); setLevelPick(null); setSearch(""); } }} />
            {states.isError && <CatalogueError message="Could not load states." onRetry={() => void states.refetch()} />}
            {states.data?.length === 0 && <Text size="sm" c="var(--mb-muted)">No states are available.</Text>}
          </div>
          <Select label="Survey level" placeholder={draft.state ? "Loading levels…" : "Choose a state first"}
            data={levelData} value={level} size="md" allowDeselect={false}
            disabled={!draft.state || levelData.length === 0}
            onChange={(value) => { if (value) { setLevelPick(value as Level); setSearch(""); } }} />
          {surveys.isError && <CatalogueError message="Could not load the survey catalogue." onRetry={() => void surveys.refetch()} />}
        </div>

        <div className={styles.columns}>
          <section aria-label="Survey rounds">
            <Heading>Survey rounds</Heading>
            <p className={styles.help}>Select the rounds you want to see in the dashboard. The level only filters this list: rounds you pick at any level stay picked.</p>
            {draft.state && surveys.isPending && <Skeleton height={76} mt="md" aria-label="Loading survey rounds" />}
            {!surveys.isError && !(draft.state && surveys.isPending) && groups.length === 0 && (
              <p className={styles.empty}>{roundPrompt}</p>
            )}
            {selected.length > 0 && (
              <ul className={styles.chips} aria-label="Selected rounds">
                {byFieldwork.map((round) => {
                  const name = round.base_name;
                  const role = name === anchor ? "Current" : name === compare ? "Baseline" : null;
                  return (
                    <li className={styles.chip} key={name} data-role={role ?? undefined}>
                      <span className={styles.chipLevel}>{LEVEL_TAG[levelOf.get(name) ?? "ac"]}</span>
                      <span className={styles.chipName}>{round.label}</span>
                      {role && <span className={styles.chipRole}>{role}</span>}
                      <button type="button" className={styles.chipRemove} aria-label={`Remove ${name}`}
                        onClick={() => toggleRound(name, false)}>×</button>
                    </li>
                  );
                })}
              </ul>
            )}
            {levelRoundCount >= SEARCH_FROM && (
              <TextInput className={styles.search} size="sm" aria-label="Search rounds" placeholder="Search rounds"
                value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
            )}
            {draft.state && !surveys.isPending && levelRoundCount > 0 && visible.every((section) => section.groups.length === 0) && (
              <p className={styles.empty}>No round matches the search.</p>
            )}
            <div className={styles.list}>
            {visible.map((section) => section.groups.map((group) => (
              <fieldset className={styles.roundGroup} key={`${section.level}:${group.group}`}>
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
                        <span id={metadataId} className={styles.roundMetadata}>{roundMetadata(round, matched ? "matched" : "extrapolated", section.level === "ac" || section.level === "pc")}</span>
                      </span>
                      {role && <span id={roleId} className={styles.roundRole}>{role}</span>}
                    </label>
                  );
                })}
              </fieldset>
            )))}
            </div>
            {multipleSeries && <p className={styles.notice}>Different survey series. Check the series names before comparing rounds.</p>}
          </section>

          {selected.length > 0 && <section className={styles.comparison} aria-label="Comparison">
            <Heading>Comparison</Heading>
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
                    <Radio value="matched" label="Matched seats only" disabled={missingNormal.length > 0 || noMatched.length > 0}
                      description="Uses Normal datasets. Geographic analyses use seats surveyed in every selected round." />
                  </Stack>
                </Radio.Group>
                {missingNormal.length > 0 && <p className={styles.notice} role={invalidCoverage ? "alert" : undefined}>
                  {missingNormal.length === 1 ? `${missingNormal[0]} has no Normal dataset.` : `No Normal datasets for ${missingNormal.join(", ")}.`}
                </p>}
                {noMatched.length > 0 && <p className={styles.notice} role={invalidCoverage ? "alert" : undefined}>
                  {`Matched seats need AC or PC rounds; ${noMatched.join(", ")} ${noMatched.length === 1 ? "is" : "are"} not.`}
                </p>}
              </details>
            )}
          </section>}
        </div>
      </div>

      <footer className={styles.footer}>
        <Text size="sm" fw={600} role="status">{status}</Text>
        <div className={styles.actions}>
          {!step && <Button variant="default" onClick={onCancel}>Cancel</Button>}
          <Button className={canApply ? styles.ready : undefined} disabled={!canApply} onClick={() => {
            // With rounds of several levels the latest is chosen here, never left to a different server ordering.
            if (canApply) onApply({
              ...draft, rounds: names, anchor_round: explicitAnchor ?? (mixedLevels ? latest : null), compare_round: compare,
              version_mode: matched ? "matched" : "extrapolated",
            });
          }}>{step ? "Continue" : "Apply selection"}</Button>
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
