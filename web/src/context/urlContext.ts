import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { Level, StateContext } from "../api/types";

const LEVELS: readonly Level[] = ["ac", "pc", "zone", "state"];

export function parseContext(params: URLSearchParams): StateContext | null {
  const state = params.get("state");
  const level = params.get("level");
  const rounds = params.getAll("rounds");
  if (!state || !level || !LEVELS.includes(level as Level) || rounds.length === 0) return null;
  return {
    state,
    level: level as Level,
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
  out.set("level", ctx.level);
  ctx.rounds.forEach((r) => out.append("rounds", r));
  if (ctx.compare_round) out.set("compare", ctx.compare_round);
  if (ctx.anchor_round) out.set("anchor", ctx.anchor_round);
  out.set("version", ctx.version_mode);
  return out;
}

export function useDashboardContext(): { ctx: StateContext | null; setCtx(next: StateContext): void } {
  const [params, setParams] = useSearchParams();
  const ctx = useMemo(() => parseContext(params), [params]);
  // Default navigation pushes, so Back restores the previous context.
  const setCtx = useCallback(
    (next: StateContext) => setParams((prev) => serialiseContext(next, prev)),
    [setParams],
  );
  return { ctx, setCtx };
}
