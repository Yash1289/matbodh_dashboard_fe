import type { Level, StateContext, SurveysResponse } from "../api/types";

const ORDER: readonly Level[] = ["ac", "pc", "zone", "state"];

/** The survey level a round belongs to, from the catalogue; null when the round is not in it. */
export function levelOfRound(surveys: SurveysResponse, name: string): Level | null {
  return ORDER.find((level) => surveys.levels[level]?.some((g) => g.rounds.some((r) => r.base_name === name))) ?? null;
}

/** The distinct levels of the context's rounds, in the order ac, pc, zone, state. */
export function levelsOf(ctx: StateContext, surveys: SurveysResponse): Level[] {
  const found = new Set(ctx.rounds.map((name) => levelOfRound(surveys, name)));
  return ORDER.filter((level) => found.has(level));
}

/** A remembered context is only offered if it names rounds and every one is still in the catalogue. */
export function isOffered(ctx: StateContext, surveys: SurveysResponse): boolean {
  return ctx.rounds.length > 0 && ctx.rounds.every((name) => levelOfRound(surveys, name) !== null);
}
