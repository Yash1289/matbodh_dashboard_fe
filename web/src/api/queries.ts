import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiGet, getRun, planCard, startRun } from "./client";
import type { CardResult, RunStatus, StateContext, SurveysResponse, Template } from "./types";

const POLL_MS = 1500;

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

export const useTemplates = (section: string) =>
  useQuery({
    queryKey: ["templates", section],
    queryFn: () => apiGet<Template[]>(`/templates?section=${encodeURIComponent(section)}`),
    staleTime: Infinity,
  });

export const useCardPlan = (cardId: string, ctx: StateContext | null) =>
  useQuery({
    queryKey: ["plan", cardId, ctx],
    queryFn: () => planCard(cardId, ctx as StateContext),
    enabled: ctx !== null,
  });

export interface CardRun {
  status: RunStatus | null;
  current: CardResult | null;
  previous: CardResult | null;
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

export function useCardRun(cardId: string, ctx: StateContext | null, enabled: boolean): CardRun {
  // Context identity by value, so an equal ctx object never restarts the run.
  const key = enabled && ctx !== null ? JSON.stringify([cardId, ctx]) : null;
  const seq = useRef(0);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [last, setLast] = useState<{ key: string; result: CardResult } | null>(null);

  const start = useCallback((k: string, restarts: number) => {
    const mine = ++seq.current;
    setAttempt({ key: k, seq: mine, runId: null, restarts, error: null });
    const [id, c] = JSON.parse(k) as [string, StateContext];
    const settle = (patch: Partial<Attempt>) =>
      setAttempt((a) => (a?.seq === mine ? { ...a, ...patch } : a));
    startRun(id, c).then((runId) => settle({ runId }), (e: unknown) => settle({ error: asApiError(e) }));
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
    retry: false,
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
  const current = status !== null && (status.state === "done" || status.state === "partial") ? status.result : null;
  useEffect(() => {
    if (active !== null && current !== null) setLast({ key: active.key, result: current });
  }, [active, current]);

  const previous = key !== null && current === null && last !== null && last.key !== key ? last.result : null;
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
