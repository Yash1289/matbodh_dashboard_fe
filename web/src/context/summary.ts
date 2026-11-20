import type { StateContext, SurveysResponse } from "../api/types";

export type PartKind = "state" | "level" | "rounds" | "compare" | "version" | "geo";
export interface SummaryPart { kind: PartKind; text: string }

/** The summary as its parts, each with the job it does, so the top bar can colour them by meaning. */
export function contextParts(ctx: StateContext, surveys: SurveysResponse): SummaryPart[] {
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
  const all: SummaryPart[] = [
    { kind: "state", text: ctx.state }, { kind: "level", text: `${ctx.level.toUpperCase()} level` },
    { kind: "rounds", text: parts.join(" + ") }, { kind: "compare", text: compare },
    { kind: "version", text: version }, { kind: "geo", text: "Geo: whole state" },
  ];
  return all.filter((p) => p.text !== ""); // a level with no picked round has no rounds part: no empty chip, no doubled separator
}

export function contextSummary(ctx: StateContext, surveys: SurveysResponse): string {
  return contextParts(ctx, surveys).map((p) => p.text).join(" · ");
}
