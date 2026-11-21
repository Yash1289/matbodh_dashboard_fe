import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { StateContext } from "../api/types";
import { useSessionCohort } from "../cohorts/cohortStore";
import { saveLastContext } from "./lastContext";

export function parseContext(params: URLSearchParams): StateContext | null {
  const state = params.get("state");
  const rounds = params.getAll("rounds");
  // A legacy `level` param is ignored: each round's level comes from the catalogue.
  if (!state || rounds.length === 0) return null;
  return {
    state,
    rounds,
    compare_round: params.get("compare"),
    anchor_round: params.get("anchor"),
    version_mode: params.get("version") === "matched" ? "matched" : "extrapolated",
    geo_scope: "state",
  };
}

export function serialiseContext(ctx: StateContext, base?: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(base);
  for (const key of ["state", "level", "rounds", "compare", "anchor", "version"]) out.delete(key);
  out.set("state", ctx.state);
  ctx.rounds.forEach((r) => out.append("rounds", r));
  if (ctx.compare_round) out.set("compare", ctx.compare_round);
  if (ctx.anchor_round) out.set("anchor", ctx.anchor_round);
  out.set("version", ctx.version_mode);
  return out;
}

export function useDashboardContext(): { ctx: StateContext | null; setCtx(next: StateContext): void } {
  const [params, setParams] = useSearchParams();
  const parsed = useMemo(() => parseContext(params), [params]);
  // The session cohort rides in the context the cards send; it is never written to the URL.
  const cohort = useSessionCohort(parsed?.state ?? null);
  const ctx = useMemo(() => (parsed && cohort ? { ...parsed, cohort } : parsed), [parsed, cohort]);
  // Default navigation pushes, so Back restores the previous context.
  const setCtx = useCallback(
    (next: StateContext) => { saveLastContext(next); setParams((prev) => serialiseContext(next, prev)); },
    [setParams],
  );
  return { ctx, setCtx };
}
