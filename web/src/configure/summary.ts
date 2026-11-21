import type { CardConfigJson, CardFilterConfig, StateContext } from "../api/types";

const list = (items: string[]): string => items.join(", ");
const some = <T,>(items: T[] | undefined): items is T[] => items !== undefined && items.length > 0;

/** "age_group × caste; gender": each cut is its own table, the fields of one cut are crossed. */
function cutsText(cuts: string[][] | undefined): string {
  const named = (cuts ?? []).filter((c) => c.length > 0);
  return named.length === 0 ? "overall" : `split by ${named.map((c) => c.join(" × ")).join("; ")}`;
}

function filtersText(filters: CardFilterConfig[] | undefined): string {
  const set = (filters ?? []).filter((f) => f.values.length > 0);
  return set.length === 0 ? "" : `, only where ${set.map((f) => `${f.field} ${f.operator === "in" ? "is" : "is not"} ${list(f.values)}`).join(" and ")}`;
}

/** Which rounds the card reads, in the analyst's own terms: the context's names, nothing added. */
function whenText(draft: CardConfigJson, ctx: StateContext): string {
  const surveys = draft.surveys ?? [];
  if (surveys.length > 1) {
    const shown = surveys.slice(0, 3);
    const more = surveys.length - shown.length;
    return `${more > 0 ? `${shown.join(", ")} and ${more} more` : shown.length === 2 ? shown.join(" and ") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`}`;
  }
  const anchor = surveys[0] ?? draft.anchor_round ?? ctx.anchor_round ?? ctx.rounds[ctx.rounds.length - 1];
  const mode = draft.comparison?.mode ?? "standalone";
  const compareTo = draft.compare_round ?? ctx.compare_round;
  if (mode === "compare") return compareTo ? `${anchor} against ${compareTo}` : anchor;
  if (mode === "trend") return draft.pipe_rounds ? `the last ${draft.pipe_rounds} rounds up to ${anchor}` : "every selected round";
  return anchor;
}

/**
 * One sentence saying what the card will show, built only from what is chosen so far (ids as they are, the
 * context's round names); null while nothing that names the card's subject is chosen.
 */
export function describeDraft(draft: CardConfigJson, ctx: StateContext): string | null {
  const when = whenText(draft, ctx);
  if (draft.family === "seat_ranking" || draft.family === "demographic_ranking") {
    const metric = draft.rank?.metric;
    if (!metric) return null;
    const party = draft.rank?.party_id ? ` for ${draft.rank.party_id}` : "";
    return `Ranks by ${metric}${party} in ${when}${filtersText(draft.rank?.filters ?? draft.filters)}.`;
  }
  if (draft.family === "relationship") {
    const { origin, destination } = draft.relationship ?? {};
    if (!origin || !destination) return null;
    return `Shows how ${origin} answers move to ${destination} in ${when}, ${cutsText(draft.cuts)}.`;
  }
  if (draft.family === "seat_benchmark") {
    if (!some(draft.scenarios)) return null;
    return `Benchmarks ${list(draft.scenarios)} in ${when}, ${cutsText(draft.benchmark?.grouping_sets)}.`;
  }
  if (!some(draft.scenarios)) return null;
  return `Shows ${list(draft.scenarios)} in ${when}, ${cutsText(draft.cuts)}${filtersText(draft.filters)}.`;
}
