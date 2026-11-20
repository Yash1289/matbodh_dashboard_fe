import { Button, Text, Title } from "@mantine/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStates, useSurveys } from "../api/queries";
import type { Level, StateContext, SurveysResponse } from "../api/types";
import { ContextDialog } from "./ContextDialog";
import styles from "./ContextDialog.module.css";
import { readLastContext } from "./lastContext";
import { contextSummary } from "./summary";
import { useDashboardContext } from "./urlContext";

/** How long the form takes to leave before the canvas opens. Skipped when the analyst asks for less motion. */
const LEAVE_MS = 160;
const reducedMotion = (): boolean => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A remembered context is only offered if every round it names is still in the catalogue at that level. */
function stillValid(ctx: StateContext, surveys: SurveysResponse): boolean {
  const known = new Set((surveys.levels[ctx.level] ?? []).flatMap((g) => g.rounds.map((r) => r.base_name)));
  return ctx.rounds.length > 0 && ctx.rounds.every((r) => known.has(r));
}

/** What the catalogue holds for one state, in the analyst's words; nothing is claimed that the catalogue does not say. */
function catalogueFacts(state: string, surveys: SurveysResponse): string {
  const levels = (Object.keys(surveys.levels) as Level[]).filter((l) => surveys.levels[l]?.some((g) => g.rounds.length));
  const rounds = new Set(levels.flatMap((l) => (surveys.levels[l] ?? []).flatMap((g) => g.rounds.map((r) => r.base_name))));
  return [state, levels.map((l) => LEVEL_NAME[l]).join(" and ") + " levels", `${rounds.size} ${rounds.size === 1 ? "round" : "rounds"}`].join(" · ");
}

const LEVEL_NAME: Record<Level, string> = { ac: "AC", pc: "PC", zone: "Zone", state: "Statewide" };

const STEPS = ["Where", "Which rounds", "Ready"] as const;

/** The mark: a ballot tick over rising bars (a vote, then understanding it). Drawn from the theme's colours. */
function Mark() {
  return (
    <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--mb-deep-ink)" />
      <rect x="6.5" y="17" width="4.5" height="8.5" rx="1.2" fill="var(--mb-surface)" />
      <rect x="13.75" y="12.5" width="4.5" height="13" rx="1.2" fill="var(--mb-surface)" />
      <rect x="21" y="8" width="4.5" height="17.5" rx="1.2" fill="var(--mb-surface)" />
      <path d="M6 7.5l2.6 2.7L13.6 4.6" fill="none" stroke="var(--mb-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The first screen: choose the state, level and rounds once; Continue opens the canvas. The bar edits them later. */
export function ContextStep() {
  const { setCtx } = useDashboardContext();
  const [done, setDone] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const states = useStates();
  const soleState = states.data?.length === 1 ? states.data[0] : null;
  const facts = useSurveys(soleState);
  const last = useMemo(readLastContext, []);
  const lastSurveys = useSurveys(last?.state ?? null);
  const offer = last !== null && lastSurveys.data !== undefined && stillValid(last, lastSurveys.data) ? last : null;

  const apply = useCallback((ctx: StateContext) => {
    if (reducedMotion()) { setCtx(ctx); return; }
    setLeaving(true);
    timer.current = setTimeout(() => setCtx(ctx), LEAVE_MS);
  }, [setCtx]);

  return (
    <div className={styles.step} data-leaving={leaving || undefined}>
      <header className={styles.stepHeader}>
        <Mark />
        <div>
          <Title order={1} className={styles.stepTitle}>Survey context</Title>
          <Text className={styles.stepLead}>
            Choose the state, survey level and rounds once. Every card on the canvas uses them, and you can change them later from the top bar.
          </Text>
          {soleState !== null && facts.data !== undefined && <Text className={styles.stepFacts}>{catalogueFacts(soleState, facts.data)}</Text>}
        </div>
      </header>
      <div className={styles.stepLayout}>
        <div className={styles.stepMain}>
          {offer !== null && lastSurveys.data !== undefined && (
            <div className={styles.resume}>
              <Text size="sm" c="var(--mb-muted)">Pick up where you left off</Text>
              <Button variant="default" autoFocus onClick={() => apply(offer)}>
                Continue with {contextSummary(offer, lastSurveys.data).split(" · ").slice(0, 4).join(" · ")}
              </Button>
            </div>
          )}
          <div className={styles.stepPanel}>
            <ContextDialog variant="step" context={null} planError={null} onCancel={() => undefined} onApply={apply} onProgress={setDone} />
          </div>
        </div>
        <ol className={styles.rail} aria-label="Progress">
          {STEPS.map((label, i) => (
            <li key={label} className={styles.railStep} data-done={done > i}>
              <span className={styles.railMark} aria-hidden="true">{done > i ? "✓" : i + 1}</span>
              <span className={styles.railLabel}>{label}</span>
              {done > i && <span className={styles.srOnly}>done</span>}
              <span className={styles.railBars} aria-hidden="true"><i /><i /><i /></span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
