import { Badge, Button, Checkbox, Group, Paper, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { useCardPlan, useStates, useSurveys } from "../api/queries";
import type { Level, StateContext, SurveyRound, SurveyVersion } from "../api/types";
import { contextSummary } from "./summary";
import { useDashboardContext } from "./urlContext";

const LEAD_CARD = "pulse.party_scoreboard";
const PROMPT = "Choose a state, survey level and rounds to begin.";
const EMPTY: StateContext = {
  state: "", level: "ac", rounds: [], compare_round: null, anchor_round: null,
  version_mode: "extrapolated", geo_scope: "state",
};
const VERSION_LABEL = { normal: "Normal", extrapolated: "Extrapolated" } as const;

const hasVersions = (level: Level) => level === "ac" || level === "pc";

function fieldwork(round: SurveyRound): string | null {
  const v: SurveyVersion | undefined = Object.values(round.versions).find((x) => x.start_date && x.end_date);
  return v ? `${v.start_date} – ${v.end_date}` : null;
}

export function ContextBar() {
  const { ctx, setCtx } = useDashboardContext();
  const [open, setOpen] = useState(ctx === null);
  const [draft, setDraft] = useState<StateContext>(ctx ?? EMPTY);
  const [levelChosen, setLevelChosen] = useState(ctx !== null);
  const states = useStates();
  const draftSurveys = useSurveys(draft.state || null);
  const ctxSurveys = useSurveys(ctx?.state ?? null);
  const plan = useCardPlan(LEAD_CARD, ctx);

  useEffect(() => {
    if (ctx) {
      setDraft(ctx);
      setLevelChosen(true);
    }
  }, [ctx]);
  useEffect(() => {
    if (!draft.state && states.data?.length === 1) setDraft((d) => ({ ...d, state: states.data?.[0] ?? "" }));
  }, [states.data, draft.state]);

  const groups = (levelChosen ? draftSurveys.data?.levels[draft.level] : undefined) ?? [];
  const apiOrder = groups.flatMap((g) => g.rounds.map((r) => r.base_name));
  const selected = apiOrder.filter((b) => draft.rounds.includes(b));
  const anchor = draft.anchor_round ?? selected[selected.length - 1] ?? null;
  const seriesCount = groups.filter((g) => g.rounds.some((r) => selected.includes(r.base_name))).length;

  const reset = { rounds: [], compare_round: null, anchor_round: null };
  const setRounds = (rounds: string[]) => {
    const ordered = apiOrder.filter((b) => rounds.includes(b));
    const keepAnchor = draft.anchor_round && ordered.includes(draft.anchor_round) ? draft.anchor_round : null;
    const eff = keepAnchor ?? ordered[ordered.length - 1] ?? null;
    const keepCompare = draft.compare_round && ordered.includes(draft.compare_round) && draft.compare_round !== eff;
    setDraft({ ...draft, rounds: ordered, anchor_round: keepAnchor, compare_round: keepCompare ? draft.compare_round : null });
  };
  const toggle = (base: string, on: boolean) =>
    setRounds(on ? [...draft.rounds, base] : draft.rounds.filter((b) => b !== base));
  const setAnchor = (value: string | null) => {
    const next = value === null || value === "latest" ? null : value;
    const eff = next ?? selected[selected.length - 1] ?? null;
    setDraft({ ...draft, anchor_round: next, compare_round: draft.compare_round === eff ? null : draft.compare_round });
  };

  const levels = Object.keys(draftSurveys.data?.levels ?? {}) as Level[];
  const canApply = draft.state !== "" && levelChosen && draft.rounds.length > 0;
  const planError = plan.error instanceof ApiError ? (plan.error.errors.join("; ") || plan.error.message) : null;

  return (
    <Paper withBorder p="sm" radius="md">
      <Group justify="space-between">
        <Text>{ctx && ctxSurveys.data ? contextSummary(ctx, ctxSurveys.data) : ctx ? "Loading context…" : "No context chosen"}</Text>
        {ctx && <Button variant="default" size="xs" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Edit"}</Button>}
      </Group>
      {open && (
        <Stack mt="sm" gap="sm">
          {ctx === null && <Text fw={500}>{PROMPT}</Text>}
          {planError && <Text c="red" role="alert">{planError}</Text>}
          <Select
            label="State" data={states.data ?? []} value={draft.state || null}
            onChange={(v) => v && setDraft({ ...EMPTY, state: v })}
            error={states.isError ? "Cannot load states" : undefined}
          />
          {draft.state && (
            <SegmentedControl
              aria-label="Level"
              data={levels.map((l) => ({ value: l, label: l.toUpperCase() }))}
              value={levelChosen ? draft.level : ""}
              onChange={(v) => {
                setLevelChosen(true);
                setDraft({ ...draft, ...reset, level: v as Level, version_mode: "extrapolated" });
              }}
            />
          )}
          {groups.map((g) => (
            <Stack key={g.group} gap={4}>
              <Text fw={600} size="sm">{g.group}</Text>
              {g.rounds.map((r) => (
                <Group key={r.base_name} gap="xs">
                  <Checkbox
                    label={r.label} checked={draft.rounds.includes(r.base_name)}
                    onChange={(e) => toggle(r.base_name, e.currentTarget.checked)}
                  />
                  {(Object.keys(r.versions) as (keyof typeof VERSION_LABEL)[]).map((k) => (
                    <Group key={k} gap={4}>
                      <Badge variant="light">{VERSION_LABEL[k]}</Badge>
                      <Text size="xs" c="dimmed">{r.versions[k]?.seats} seats</Text>
                    </Group>
                  ))}
                  {fieldwork(r) && <Text size="xs" c="dimmed">{fieldwork(r)}</Text>}
                </Group>
              ))}
            </Stack>
          ))}
          {seriesCount > 1 && <Badge color="yellow">Different survey series</Badge>}
          <Select
            label="Compare" data={[{ value: "none", label: "None" }, ...selected.filter((b) => b !== anchor).map((b) => ({ value: b, label: b }))]}
            value={draft.compare_round ?? "none"} allowDeselect={false}
            onChange={(v) => setDraft({ ...draft, compare_round: v === null || v === "none" ? null : v })}
          />
          <Select
            label="Anchor" data={[{ value: "latest", label: "Latest (default)" }, ...selected.map((b) => ({ value: b, label: b }))]}
            value={draft.anchor_round ?? "latest"} allowDeselect={false} onChange={setAnchor}
          />
          {hasVersions(draft.level) ? (
            <SegmentedControl
              aria-label="Version"
              data={[{ value: "extrapolated", label: "Extrapolated" }, { value: "matched", label: "Matched seats" }]}
              value={draft.version_mode}
              onChange={(v) => setDraft({ ...draft, version_mode: v === "matched" ? "matched" : "extrapolated" })}
            />
          ) : (
            <Text size="sm">Normal only</Text>
          )}
          <Group>
            <Button disabled={!canApply} onClick={() => { setCtx({ ...draft, geo_scope: "state" }); setOpen(false); }}>Apply</Button>
          </Group>
        </Stack>
      )}
    </Paper>
  );
}
