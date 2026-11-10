import { vi } from "vitest";
import type { CardInfo, GridPayload, PlanResponse, RunStatus } from "../api/types";
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

export const infoFor = (p: GridPayload, over: Partial<CardInfo> = {}): CardInfo => ({
  id: p.card_id, family: p.family, section: "cards", title: `Card ${p.card_id}`, scenarios: [], cuts: [], filters: [],
  comparison: { mode: p.mode, target: null, reference: null, delta_measures: [] },
  caste_clubbing: false, requires: { min_level: "state" }, meta: p.meta, ...over,
});

export const doneRun = (p: GridPayload): RunStatus => ({ state: "done", done: 1, total: 1, result: p, errors: {} });

export const planFor = (p: GridPayload, unavailable: PlanResponse["unavailable"] = []): PlanResponse => ({
  valid: true, errors: [], unavailable, not_asked: [], coverage_mode: { grid: "independent" },
  rounds: p.rounds.items.map(({ cycle: _cycle, series: _series, ...rest }) => rest),
});

export interface CardApiOptions {
  payloads: GridPayload[];
  /** Per-card overrides: the plan's unavailable list, or a custom run status. */
  unavailable?: Record<string, PlanResponse["unavailable"]>;
  runs?: Record<string, RunStatus>;
  /** A status other than 200 makes POST /cards/run fail with that status. */
  runStatus?: number;
}

/** A fetch stub serving the cards API; returns the mock so tests can count requests. */
export function stubCardApi({ payloads, unavailable = {}, runs = {}, runStatus = 200 }: CardApiOptions) {
  const byCard = new Map(payloads.map((p) => [p.card_id, p]));
  const reply = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status });
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api/, "");
    const body = init?.body ? (JSON.parse(String(init.body)) as { card_id?: string }) : {};
    if (path === "/catalogue/states") return reply(states);
    if (path.endsWith("/surveys")) return reply(surveys);
    if (path.startsWith("/cards") && init?.method !== "POST") return reply([...byCard.values()].map((p) => infoFor(p)));
    if (path === "/cards/plan") return reply(planFor(byCard.get(body.card_id ?? "")!, unavailable[body.card_id ?? ""] ?? []));
    if (path === "/cards/run") return runStatus === 200 ? reply({ run_id: body.card_id }) : reply({ detail: "boom" }, runStatus);
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
