import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiGet, fetchOptions, getRun, planCard, startRun } from "./client";
import type {
  BenchmarkReference, CardConfigJson, CardInfo, CardPayload, CardRef, FamilyDescriptor, GridPayload,
  OptionItem, RunStatus, StateContext, SurveysResponse,
} from "./types";

const POLL_MS = 1500;

/** Exponential retry delay: 1 s, 2 s, 4 s, capped at 5 s. */
export const backoff = (attempt: number): number => Math.min(1000 * 2 ** attempt, 5000);

export const useStates = () =>
  useQuery({
    queryKey: ["states"],
    queryFn: () => apiGet<{ states: string[] }>("/catalogue/states"),
    select: (r) => r.states,
    staleTime: 5 * 60_000,
  });

export const useSurveys = (state: string | null) =>
  useQuery({
    queryKey: ["surveys", state],
    queryFn: () => apiGet<SurveysResponse>(`/catalogue/${encodeURIComponent(state ?? "")}/surveys`),
    enabled: state !== null,
    staleTime: 5 * 60_000,
  });

/** The engine's card definitions (with each family's lenses and capabilities). */
export const useCards = (section?: string) =>
  useQuery({
    queryKey: ["cards", section ?? null],
    queryFn: () => apiGet<CardInfo[]>(section === undefined ? "/cards" : `/cards?section=${encodeURIComponent(section)}`),
    staleTime: Infinity,
  });

export const useCardPlan = (ref: CardRef, ctx: StateContext | null, reference: BenchmarkReference | null = null) =>
  useQuery({
    queryKey: ["plan", ref, ctx, reference],
    queryFn: () => planCard(ref, ctx as StateContext, reference),
    enabled: ctx !== null,
  });

/** What Configure draws for each card family; fixed for a deploy. */
export const useFamilies = () =>
  useQuery({
    queryKey: ["configure-families"],
    queryFn: () => apiGet<FamilyDescriptor[]>("/configure/families"),
    staleTime: Infinity,
  });

/** The draft parts that change which rounds a card reads, and so which options are valid. */
const roundsReadKey = (d: CardConfigJson) => ({
  family: d.family, scenarios: d.scenarios, comparison: d.comparison, pipe_rounds: d.pipe_rounds,
  reference: d.benchmark?.reference, origin: d.relationship?.origin, destination: d.relationship?.destination,
  level: d.rank?.level,
});

/** An option list for a field of the draft card; asked again only when the rounds read change. */
export const useOptions = (
  source: string, params: Record<string, string>, draft: CardConfigJson, ctx: StateContext | null,
) =>
  useQuery<OptionItem[]>({
    queryKey: ["options", source, params, roundsReadKey(draft), ctx],
    queryFn: () => fetchOptions(source, params, draft, ctx as StateContext),
    enabled: ctx !== null,
    staleTime: 60_000,
    // Keep the last list while a changed draft asks again, so the panel never flashes empty or remounts.
    placeholderData: keepPreviousData,
  });

/** What each cut field describes (seat or respondent); empty until known, and unknown fields have no scope. */
export function useFieldScopes(family: string, ctx: StateContext | null): Record<string, "seat" | "respondent" | null> {
  const options = useOptions("fields", { use: "cut", family }, { family } as CardConfigJson, ctx);
  return useMemo(() => Object.fromEntries((options.data ?? []).map((o) => [o.value, o.scope ?? null])), [options.data]);
}

/** `P` is the payload type the card's family returns; grid cards are the default. */
export interface CardRun<P extends CardPayload = GridPayload> {
  status: RunStatus | null;
  current: P | null;
  previous: P | null;
  isStale: boolean;
  error: ApiError | null;
  refresh(): void;
}

/** One start of a run; `seq` is unique per start so late answers of older starts are ignored. */
interface Attempt {
  key: string;
  seq: number;
  runId: string | null;
  restarts: number;
  error: ApiError | null;
}

const asApiError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, [], e instanceof Error ? e.message : String(e));

export function useCardRun<P extends CardPayload = GridPayload>(
  ref: CardRef, ctx: StateContext | null, enabled: boolean, reference: BenchmarkReference | null = null,
): CardRun<P> {
  // Card and context identity by value, so an equal object never restarts the run.
  const key = enabled && ctx !== null ? JSON.stringify([ref, ctx, reference]) : null;
  const seq = useRef(0);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [last, setLast] = useState<{ key: string; result: P } | null>(null);

  const start = useCallback((k: string, restarts: number) => {
    const mine = ++seq.current;
    setAttempt({ key: k, seq: mine, runId: null, restarts, error: null });
    const [cardRef, c, bench] = JSON.parse(k) as [CardRef, StateContext, BenchmarkReference | null];
    const settle = (patch: Partial<Attempt>) =>
      setAttempt((a) => (a?.seq === mine ? { ...a, ...patch } : a));
    startRun(cardRef, c, bench).then((runId) => settle({ runId }), (e: unknown) => settle({ error: asApiError(e) }));
  }, []);

  useEffect(() => {
    if (key !== null) start(key, 0);
  }, [key, start]);

  const active = attempt !== null && attempt.key === key ? attempt : null;
  const runId = active?.runId ?? null;
  const poll = useQuery({
    queryKey: ["run", runId, active?.seq ?? 0],
    queryFn: () => getRun(runId as string),
    enabled: runId !== null,
    // Infrastructure blips retry; a 404 (evicted run) restarts the run instead, with no retry.
    retry: (n, e) => e instanceof ApiError && (e.status >= 500 || e.status === 0) && n < 3,
    retryDelay: backoff,
    // A finished run never changes; focus/reconnect refetches could 404 on an evicted run.
    staleTime: Infinity,
    refetchInterval: (q) => (q.state.status !== "error" && q.state.data?.state === "running" ? POLL_MS : false),
  });

  const pollError = poll.error === null ? null : asApiError(poll.error);
  const restartPending = pollError?.status === 404 && active?.restarts === 0;
  useEffect(() => {
    if (restartPending && active !== null) start(active.key, 1);
  }, [restartPending, active, start]);

  const status = active !== null && poll.data !== undefined ? poll.data : null;
  // The service returns the payload type of the card's family; the caller names it with `P`.
  const current = (status !== null && (status.state === "done" || status.state === "partial")
    ? status.result : null) as P | null;
  useEffect(() => {
    if (active !== null && current !== null) setLast({ key: active.key, result: current });
  }, [active, current]);

  // From the context, not `enabled`: the previous result stays visible while a new plan is pending.
  const ctxKey = ctx !== null ? JSON.stringify([ref, ctx, reference]) : null;
  const previous = ctxKey !== null && current === null && last !== null && last.key !== ctxKey ? last.result : null;
  return {
    status,
    current,
    previous,
    isStale: previous !== null,
    error: active?.error ?? (restartPending ? null : pollError),
    refresh: useCallback(() => {
      if (key !== null) start(key, 0);
    }, [key, start]),
  };
}
