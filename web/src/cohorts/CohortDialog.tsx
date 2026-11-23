import { Alert, Button, Group, Modal, NumberInput, Stack, Text, TextInput } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError, getRun } from "../api/client";
import type { BenchmarkReference, CardRef, CohortPreview, StateContext } from "../api/types";
import { startPreview } from "./cohortApi";
import { chipStyle } from "../cards/PopoverChip";
import { setCohort } from "./cohortStore";
import styles from "./cohort.module.css";
import {
  CHANGE, NO_BENCHMARK_CHOICE, NO_RANKING_CHOICE, STANDING, benchmarkPredicate, cohortName, describeBenchmark, describeRanking,
  rankingPredicate, type BenchmarkChoice, type Outcome, type OutcomeOption, type RankingChoice,
} from "./selection";

const POLL_MS = 1500;
const MAX_LISTED = 40;

interface Props {
  opened: boolean;
  onClose(): void;
  card: CardRef;
  kind: "ranking" | "benchmark";
  ctx: StateContext;
  reference: BenchmarkReference | null;
  /** A flip compares two surveys, so it is offered only when the card has a reference. */
  hasReference: boolean;
  cardTitle: string;
}

const message = (e: unknown) => (e instanceof ApiError ? e.errors.join("; ") || e.message : e instanceof Error ? e.message : String(e));

/** One chip over a real radio button: native keyboard and screen-reader behaviour, the app's chip look. */
function Choice({ name, value, label, checked, onChange }: { name: string; value: string; label: string; checked: boolean; onChange(): void }) {
  return (
    <label className={styles.choice} style={chipStyle(checked)}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

/** Picks the seats of a seat ranking or benchmark card, finds them, and keeps them as the session cohort. */
export function CohortDialog({ opened, onClose, card, kind, ctx, reference, hasReference, cardTitle }: Props) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const [bench, setBench] = useState<BenchmarkChoice>(NO_BENCHMARK_CHOICE);
  const [rank, setRank] = useState<RankingChoice>(NO_RANKING_CHOICE);
  const [name, setName] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  /** A changed selection makes the previous result stale. */
  const changed = () => { setRunId(null); setStartError(null); };
  const editBench = (patch: Partial<BenchmarkChoice>) => { setBench((b) => ({ ...b, ...patch })); changed(); };
  const editRank = (patch: Partial<RankingChoice>) => { setRank((r) => ({ ...r, ...patch })); changed(); };

  const predicate = kind === "ranking" ? rankingPredicate(rank) : benchmarkPredicate(bench, hasReference);
  const what = kind === "ranking" ? describeRanking(rank) : describeBenchmark(bench, hasReference);
  const empty = Object.keys(predicate).length === 0;

  const run = useQuery({
    queryKey: ["cohort-preview", runId],
    queryFn: () => getRun(runId as string),
    enabled: runId !== null,
    refetchInterval: (q) => (q.state.status !== "error" && q.state.data?.state === "running" ? POLL_MS : false),
  });
  const preview = run.data?.state === "done" ? (run.data.result as unknown as CohortPreview) : null;
  const failure = startError ?? (run.isError ? message(run.error) : null)
    ?? (run.data?.state === "failed" ? Object.values(run.data.errors).map((e) => e.message).join("; ") : null);
  const running = runId !== null && preview === null && failure === null;
  const found = preview !== null && preview.count > 0;

  const preparePreview = () => {
    setStartError(null);
    startPreview(card, ctx, predicate, reference).then(setRunId, (e: unknown) => setStartError(message(e)));
  };

  const defaultName = cohortName(cardTitle, what);
  const use = () => {
    if (preview === null || preview.count === 0) return;
    setCohort(ctx.state, {
      seat_level: preview.seat_level, seat_ids: preview.seat_ids,
      label: (name?.trim() || defaultName).slice(0, 120), created_at: new Date().toISOString(),
    });
    onClose();
    navigate({ pathname: "/cohort", search });
  };

  const picked = [...STANDING, ...CHANGE].find((o) => o.value === bench.outcome);
  const outcome = (o: OutcomeOption) => (
    <Choice key={o.value} name="cohort-outcome" value={o.value} label={o.label} checked={bench.outcome === o.value}
      onChange={() => editBench({ outcome: o.value })} />
  );
  const readIn: { value: BenchmarkChoice["readIn"]; label: string }[] = [{ value: "target", label: "This survey" }, { value: "reference", label: "The reference" }];

  return (
    <Modal opened={opened} onClose={onClose} title="Make a cohort" centered>
      <Stack gap="md">
        <div data-testid="cohort-source">
          <Text size="sm" c="var(--mb-muted)">
            Taken from <b>{cardTitle}</b> ({kind === "ranking" ? "seat ranking" : hasReference ? "seat benchmark with a reference" : "seat benchmark"}),
            across the whole state. The seats are kept for this session only.
          </Text>
        </div>

        {kind === "ranking" ? (
          <>
            <NumberInput label="Top N in each group" min={1} allowDecimal={false} value={rank.rankMax}
              onChange={(v) => editRank({ rankMax: v === "" ? "" : Number(v) })} description="Seats tied at the cut-off are included." />
            <div className={styles.step} role="group" aria-label="Metric range">
              <span className={styles.legend}>Metric range</span>
              <div className={styles.range}>
                <NumberInput label="Metric at least" value={rank.metricMin} onChange={(v) => editRank({ metricMin: v === "" ? "" : Number(v) })} />
                <span className={styles.to} aria-hidden>to</span>
                <NumberInput label="Metric below" value={rank.metricMax} onChange={(v) => editRank({ metricMax: v === "" ? "" : Number(v) })} />
              </div>
            </div>
          </>
        ) : (
          <>
            <fieldset className={styles.step}>
              <legend className={styles.legend}>Outcome</legend>
              <div>
                {hasReference && <div className={styles.sub}>In this survey</div>}
                <div className={styles.row}>
                  <Choice name="cohort-outcome" value="" label="Any" checked={bench.outcome === ""} onChange={() => editBench({ outcome: "" as Outcome })} />
                  {STANDING.map(outcome)}
                </div>
              </div>
              {hasReference && (
                <div>
                  <div className={styles.sub}>Compared with the reference</div>
                  <div className={styles.row}>{CHANGE.map(outcome)}</div>
                </div>
              )}
              <div className={styles.hint} aria-live="polite">{picked?.hint ?? ""}</div>
            </fieldset>

            <div className={styles.step} role="group" aria-label="Margin">
              <span className={styles.legend}>Margin, in percentage points</span>
              <div className={styles.range}>
                <NumberInput label="Margin at least" value={bench.marginMin} onChange={(v) => editBench({ marginMin: v === "" ? "" : Number(v) })} />
                <span className={styles.to} aria-hidden>to</span>
                <NumberInput label="Margin below" value={bench.marginMax} onChange={(v) => editBench({ marginMax: v === "" ? "" : Number(v) })} />
              </div>
              <Text size="sm" c="var(--mb-muted)">Positive means ahead, negative means behind. Leave a side empty for no limit.</Text>
            </div>

            {hasReference && (
              <fieldset className={styles.step}>
                <legend className={styles.legend}>Read the outcome and margin in</legend>
                <div className={styles.row}>
                  {readIn.map((o) => (
                    <Choice key={o.value} name="cohort-read-in" value={o.value} label={o.label} checked={bench.readIn === o.value}
                      onChange={() => editBench({ readIn: o.value })} />
                  ))}
                </div>
              </fieldset>
            )}
          </>
        )}

        <div className={styles.sentence} data-empty={what === null} aria-live="polite" data-testid="cohort-sentence">
          {what === null ? "Choose at least one condition to find seats." : <>Seats with <b>{what}</b>.</>}
        </div>

        {failure !== null && <Alert color="red" role="alert">{failure}</Alert>}
        {preview !== null && (
          <div className={styles.result}>
            <div className={styles.count}>{preview.count === 0 ? "No seats matched" : `${preview.count} seat${preview.count === 1 ? "" : "s"} matched`}</div>
            {found && (
              <>
                <div className={styles.seats} data-testid="cohort-seats">
                  {preview.seat_level.toUpperCase()} {preview.seat_ids.slice(0, MAX_LISTED).join(", ")}{preview.count > MAX_LISTED ? " …" : ""}
                </div>
                <TextInput label="Cohort name" description="Shown on the tab and in the top bar. You can rename it later."
                  value={name ?? defaultName} maxLength={120} onChange={(e) => setName(e.currentTarget.value)} />
              </>
            )}
          </div>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button variant={found ? "default" : "filled"} disabled={empty || running} loading={running} onClick={preparePreview}>
            {preview === null ? "Find seats" : "Find seats again"}
          </Button>
          <Button variant={found ? "filled" : "default"} disabled={!found} onClick={use}>Use as cohort</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
