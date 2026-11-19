import { apiPost } from "../api/client";
import type { BenchmarkReference, CardRef, SelectionPredicate, StateContext } from "../api/types";

/** Starts the selection run for a card; poll the run id with `getRun` like any card run. */
export const startPreview = async (
  card: CardRef, ctx: StateContext, predicate: SelectionPredicate, reference?: BenchmarkReference | null,
): Promise<string> =>
  // Seats are always selected from the whole state, so an earlier cohort never narrows the new one.
  (await apiPost<{ run_id: string }>("/cohorts/preview", {
    ...card, context: { ...ctx, cohort: null }, predicate, ...(reference ? { reference } : {}),
  })).run_id;
