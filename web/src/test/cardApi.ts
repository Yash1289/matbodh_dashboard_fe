import { vi } from "vitest";
import { isBenchmarkPayload, isRankedPayload, isRelationshipPayload } from "../api/types";
import type {
  BenchmarkPayload, CardInfo, CardPayload, CohortPreview, ElectionOption, FamilyMeta, GridPayload, PlanResponse, RankedPayload,
  RelationshipPayload, RunStatus,
} from "../api/types";
import benchmarkSurveyVs2022 from "./fixtures/cards/benchmark_survey_vs_2022.json";
import relationshipTransition from "./fixtures/cards/relationship_transition.json";
import rankedDemographic from "./fixtures/cards/ranked_demographic_standalone.json";
import rankedSeatStandalone from "./fixtures/cards/ranked_seat_standalone.json";
import rankedSeatTrend from "./fixtures/cards/ranked_seat_trend.json";
import distributionCompare from "./fixtures/cards/distribution_compare.json";
import distributionStandalone from "./fixtures/cards/distribution_standalone.json";
import distributionTrend from "./fixtures/cards/distribution_trend.json";
import genderStandalone from "./fixtures/cards/gender_differential_standalone.json";
import opinionStandalone from "./fixtures/cards/opinion_standalone.json";
import states from "./fixtures/states.json";
import surveys from "./fixtures/surveys.json";

/** JSON imports widen string-literal unions, so payload fixtures are cast once, here. */
export const payloadOf = (fixture: unknown): GridPayload => structuredClone(fixture) as GridPayload;

export const PAYLOADS = {
  distributionStandalone: () => payloadOf(distributionStandalone),
  distributionCompare: () => payloadOf(distributionCompare),
  distributionTrend: () => payloadOf(distributionTrend),
  opinionStandalone: () => payloadOf(opinionStandalone),
  genderStandalone: () => payloadOf(genderStandalone),
};

export const rankedOf = (fixture: unknown): RankedPayload => structuredClone(fixture) as RankedPayload;

export const RANKED = {
  seatStandalone: () => rankedOf(rankedSeatStandalone),
  seatTrend: () => rankedOf(rankedSeatTrend),
  demographic: () => rankedOf(rankedDemographic),
};

export const benchmarkOf = (fixture: unknown): BenchmarkPayload => structuredClone(fixture) as BenchmarkPayload;

export const BENCHMARK = { surveyVs2022: () => benchmarkOf(benchmarkSurveyVs2022) };

export const relationshipOf = (fixture: unknown): RelationshipPayload => structuredClone(fixture) as RelationshipPayload;

export const RELATIONSHIP = { transition: () => relationshipOf(relationshipTransition) };

// Ranking, benchmark and relationship payloads carry no lenses; the card list sends an empty family meta for them.
const lenslessMeta = (p: RankedPayload | BenchmarkPayload | RelationshipPayload): FamilyMeta => ({
  family: p.family, lenses: [], default_lens: "",
  capabilities: { modes: ["standalone", "compare", "trend"], transpose: false, sort: true, details: true },
});

export const infoFor = (p: CardPayload, over: Partial<CardInfo> = {}): CardInfo => ({
  id: p.card_id, family: p.family, section: "cards", title: `Card ${p.card_id}`, scenarios: [], cuts: [], filters: [],
  comparison: { mode: isBenchmarkPayload(p) || isRelationshipPayload(p) ? "standalone" : p.mode, target: null, reference: null, delta_measures: [] },
  caste_clubbing: false, requires: { min_level: "state" },
  meta: isRankedPayload(p) || isBenchmarkPayload(p) || isRelationshipPayload(p) ? lenslessMeta(p) : p.meta, ...over,
});

export const doneRun = (p: CardPayload): RunStatus => ({ state: "done", done: 1, total: 1, result: p, errors: {} });

export const planFor = (p: CardPayload, unavailable: PlanResponse["unavailable"] = []): PlanResponse => ({
  valid: true, errors: [], unavailable, not_asked: [], coverage_mode: { grid: "independent" },
  rounds: p.rounds.items.map(({ cycle: _cycle, series: _series, ...rest }) => rest),
});

export interface CardApiOptions {
  payloads: CardPayload[];
  /** Per-card overrides: the plan's unavailable list, or a custom run status. */
  unavailable?: Record<string, PlanResponse["unavailable"]>;
  runs?: Record<string, RunStatus>;
  /** A status other than 200 makes POST /cards/run fail with that status. */
  runStatus?: number;
  /** What GET /catalogue/{state}/elections lists. */
  elections?: ElectionOption[];
  /** What POST /cohorts/preview finishes with, or the 422 reason it answers instead. */
  preview?: CohortPreview;
  previewError?: string;
}

/** A fetch stub serving the cards API; returns the mock so tests can count requests. */
export function stubCardApi({ payloads, unavailable = {}, runs = {}, runStatus = 200, elections = [], preview, previewError }: CardApiOptions) {
  const byCard = new Map(payloads.map((p) => [p.card_id, p]));
  const reply = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status });
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api/, "");
    const sent = init?.body ? (JSON.parse(String(init.body)) as { card_id?: string; card?: { id: string } }) : {};
    const body = { card_id: sent.card_id ?? sent.card?.id };
    if (path === "/catalogue/states") return reply(states);
    if (path.endsWith("/surveys")) return reply(surveys);
    if (path.endsWith("/elections")) return reply(elections);
    if (path.startsWith("/cards") && init?.method !== "POST") return reply([...byCard.values()].map((p) => infoFor(p)));
    // A card the stub has no payload for (the context bar's own) is planned like the first payload.
    if (path === "/cards/plan") {
      return reply(planFor(byCard.get(body.card_id ?? "") ?? payloads[0], unavailable[body.card_id ?? ""] ?? []));
    }
    if (path === "/cards/run") return runStatus === 200 ? reply({ run_id: body.card_id }) : reply({ detail: "boom" }, runStatus);
    if (path === "/cohorts/preview") {
      return previewError === undefined ? reply({ run_id: "cohort-preview" })
        : reply({ valid: false, errors: [previewError] }, 422);
    }
    if (path === "/runs/cohort-preview") {
      return reply({ state: "done", done: 1, total: 1, result: preview, errors: {} });
    }
    if (path.startsWith("/runs/")) {
      const id = decodeURIComponent(path.replace(/^\/runs\//, ""));
      return reply(runs[id] ?? doneRun(byCard.get(id)!));
    }
    return reply({ detail: "not found" }, 404);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

export const CONTEXT_QUERY = "?state=Uttar+Pradesh&level=ac&rounds=R1&rounds=R2&compare=R1&anchor=R2&version=extrapolated";
