import type { SelectionPredicate } from "../api/types";

/**
 * What the analyst chose in the form. The engine combines every part with AND, but a seat's outcome is one
 * thing: "winning in this survey" and "gained since the reference" are alternatives, so they are one choice.
 */
export type Outcome = "" | "winning" | "losing" | "gain" | "loss" | "winning_both" | "losing_both";

export interface BenchmarkChoice {
  outcome: Outcome;
  marginMin: number | "";
  marginMax: number | "";
  /** Which survey the outcome and margin are read in; only offered when the card has a reference. */
  readIn: "target" | "reference";
}

export interface RankingChoice {
  rankMax: number | "";
  metricMin: number | "";
  metricMax: number | "";
}

export const NO_BENCHMARK_CHOICE: BenchmarkChoice = { outcome: "", marginMin: "", marginMax: "", readIn: "target" };
export const NO_RANKING_CHOICE: RankingChoice = { rankMax: "", metricMin: "", metricMax: "" };

export interface OutcomeOption { value: Outcome; label: string; hint: string }

/** Where the party stands in one survey. */
export const STANDING: OutcomeOption[] = [
  { value: "winning", label: "Winning", hint: "The party leads the seat." },
  { value: "losing", label: "Losing", hint: "Another party leads the seat." },
];

/** How the seat changed between the reference and this survey; needs a reference. */
export const CHANGE: OutcomeOption[] = [
  { value: "gain", label: "Gain", hint: "Not won in the reference, won in this survey." },
  { value: "loss", label: "Loss", hint: "Won in the reference, not won in this survey." },
  { value: "winning_both", label: "Won in both", hint: "Won in the reference and in this survey." },
  { value: "losing_both", label: "Not won in either", hint: "Won in neither the reference nor this survey." },
];

const FLIPS = new Set<Outcome>(["gain", "loss", "winning_both", "losing_both"]);
const given = (v: number | ""): v is number => v !== "";

/** The request the engine takes. A flip fixes the outcome in both surveys, so status and flip are never sent together. */
export function benchmarkPredicate(c: BenchmarkChoice, hasReference: boolean): SelectionPredicate {
  const out: SelectionPredicate = {};
  if (c.outcome === "winning" || c.outcome === "losing") out.status = c.outcome;
  else if (c.outcome !== "" && hasReference) out.flip = c.outcome as NonNullable<SelectionPredicate["flip"]>;
  if (given(c.marginMin)) out.margin_min = c.marginMin;
  if (given(c.marginMax)) out.margin_max = c.marginMax;
  if (hasReference && c.readIn === "reference" && (out.status !== undefined || given(c.marginMin) || given(c.marginMax))) out.endpoint = "reference";
  return out;
}

export function rankingPredicate(c: RankingChoice): SelectionPredicate {
  const out: SelectionPredicate = {};
  if (given(c.rankMax)) out.rank_max = c.rankMax;
  if (given(c.metricMin)) out.metric_min = c.metricMin;
  if (given(c.metricMax)) out.metric_max = c.metricMax;
  return out;
}

const minus = (n: number) => String(n).replace("-", "−");

const range = (low: number | "", high: number | "", what: string): string | null => {
  if (given(low) && given(high)) return `${what} from ${minus(low)} to below ${minus(high)}`;
  if (given(low)) return `${what} of ${minus(low)} or more`;
  if (given(high)) return `${what} below ${minus(high)}`;
  return null;
};

/** The choice in words, shared by the live sentence, the cohort's name and the tab. Null when nothing is chosen. */
export function describeBenchmark(c: BenchmarkChoice, hasReference: boolean): string | null {
  const parts: string[] = [];
  const where = hasReference && c.readIn === "reference" ? " in the reference" : "";
  const found = [...STANDING, ...CHANGE].find((o) => o.value === c.outcome);
  if (found !== undefined && (FLIPS.has(c.outcome) ? hasReference : true)) {
    parts.push(FLIPS.has(c.outcome) ? found.label.toLowerCase() : `${found.label.toLowerCase()}${where}`);
  }
  const margin = range(c.marginMin, c.marginMax, "margin");
  if (margin !== null) parts.push(`${margin}${where}`);
  return parts.length === 0 ? null : parts.join(", ");
}

export function describeRanking(c: RankingChoice): string | null {
  const parts: string[] = [];
  if (given(c.rankMax)) parts.push(`top ${c.rankMax} in each group`);
  const metric = range(c.metricMin, c.metricMax, "metric");
  if (metric !== null) parts.push(metric);
  return parts.length === 0 ? null : parts.join(", ");
}

/** A name short enough for a tab; the analyst can rename it. */
export const cohortName = (cardTitle: string, what: string | null): string =>
  `${cardTitle}${what === null ? "" : ` · ${what}`}`.slice(0, 120);
