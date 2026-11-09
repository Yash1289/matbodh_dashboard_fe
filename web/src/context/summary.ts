import type { StateContext, SurveysResponse } from "../api/types";

export function contextSummary(ctx: StateContext, surveys: SurveysResponse): string {
  const groups = surveys.levels[ctx.level] ?? [];
  const parts: string[] = [];
  for (const g of groups) {
    const picked = g.rounds.filter((r) => ctx.rounds.includes(r.base_name));
    if (picked.length === 0) continue;
    const first = picked[0].label;
    const last = picked[picked.length - 1].label;
    parts.push(`${g.group} ${first === last ? first : `${first}–${last}`}`);
  }
  const compare = ctx.compare_round ? `Δ vs ${ctx.compare_round}` : "No Δ";
  const hasVersions = ctx.level === "ac" || ctx.level === "pc";
  const version = !hasVersions ? "Normal only" : ctx.version_mode === "matched" ? "Matched seats" : "Extrapolated";
  return [ctx.state, `${ctx.level.toUpperCase()} level`, parts.join(" + "), compare, version, "Geo: whole state"].join(" · ");
}
