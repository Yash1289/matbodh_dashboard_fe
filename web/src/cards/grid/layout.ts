import type { GridPayload } from "../../api/types";

/**
 * Layouts for a card that reads several surveys or several questions (spec 2026-11-21). Each one re-shapes
 * the engine's payload before payloadToGrid and only copies engine values: no number is computed here.
 * Display state only, so choosing a survey, question or party never sends a request.
 */
export interface LayoutView { survey?: string | null; question?: string | null; party?: string | null }

const isStandalone = (p: GridPayload) => p.mode === "standalone";
export const surveysOf = (p: GridPayload) => (isStandalone(p) ? p.rounds.items.filter((i) => p.cuts.some((c) => c.cells.some((x) => x.round === i.obs_id))) : []);
export const questionsOf = (p: GridPayload): string[] => [...new Set(p.columns.map((c) => c.scenario))];
const isOverall = (p: GridPayload, cutId: string) => (p.cuts.find((c) => c.id === cutId)?.dimensions.length ?? 0) === 0;
const partyOf = (key: string) => key.slice(key.lastIndexOf(":") + 1);
export const partiesOf = (p: GridPayload): string[] => [...new Set(p.columns.filter((c) => c.kind === "party").map((c) => partyOf(c.key)))];

/** Which display choices this payload and cut call for (the card draws a selector for each). */
export function layoutNeeds(p: GridPayload, cutId: string) {
  const many = surveysOf(p).length > 1;
  const questions = questionsOf(p).length > 1;
  const overall = isOverall(p, cutId);
  return {
    survey: many && !overall,
    question: questions && !overall,
    // Several questions across several surveys: one party's share per question, chosen here.
    party: many && questions && overall && partiesOf(p).length > 1,
  };
}

/** A cut with several surveys is read one survey at a time: keep that survey's values. */
export function applySurvey(p: GridPayload, round: string): GridPayload {
  const keep = <T extends { round: string | null }>(xs: T[]) => xs.filter((x) => x.round === round);
  return { ...p, cuts: p.cuts.map((c) => ({ ...c, cells: keep(c.cells), bases: keep(c.bases) })) };
}

export const applyQuestion = (p: GridPayload, scenario: string): GridPayload =>
  ({ ...p, columns: p.columns.filter((c) => c.scenario === scenario) });

/** One party's column per question (the single measure of a several-by-several table). */
export const applyParty = (p: GridPayload, party: string): GridPayload =>
  ({ ...p, columns: p.columns.filter((c) => c.kind !== "party" || partyOf(c.key) === party).map((c) => (c.kind === "party" ? { ...c, label: c.scenario } : c)) });

/** Overall with several surveys: one row per survey (the existing transpose swaps surveys with the breakdown). */
export function acrossSurveys(p: GridPayload, cutId: string): GridPayload {
  const surveys = surveysOf(p);
  const anchor = p.rounds.anchor;
  const cuts = p.cuts.map((cut) => {
    if (cut.id !== cutId) return cut;
    const rekey = <T extends { round: string | null; row: string }>(xs: T[]) =>
      xs.filter((x) => x.round !== null).map((x) => ({ ...x, row: x.round as string, round: anchor }));
    return {
      ...cut,
      rows: surveys.map((s) => ({ key: s.obs_id, labels: { survey: s.label }, subtotal: [] })),
      cells: rekey(cut.cells), bases: rekey(cut.bases), deltas: [],
    };
  });
  return { ...p, cuts };
}

/** The payload the table shows for the chosen layout; unchanged for one survey and one question. */
export function layoutPayload(p: GridPayload, cutId: string, view: LayoutView): GridPayload {
  if (!isStandalone(p)) return p;
  const surveys = surveysOf(p);
  const questions = questionsOf(p);
  const need = layoutNeeds(p, cutId);
  let out = p;
  if (surveys.length > 1) {
    if (need.survey) out = applySurvey(out, view.survey && surveys.some((s) => s.obs_id === view.survey) ? view.survey : surveys[0].obs_id);
    else out = acrossSurveys(out, cutId);
  }
  if (need.question) out = applyQuestion(out, view.question && questions.includes(view.question) ? view.question : questions[0]);
  if (need.party) {
    const parties = partiesOf(p);
    out = applyParty(out, view.party && parties.includes(view.party) ? view.party : parties[0]);
  }
  return out;
}
