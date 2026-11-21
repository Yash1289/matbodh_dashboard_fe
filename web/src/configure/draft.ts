import type { CardConfigJson, FamilyDescriptor, StateContext } from "../api/types";
import { getPath, pruneHidden, setPath, visibleFields, type ScenarioKinds } from "./conditions";

/**
 * The draft as it will be validated and applied: values of hidden fields removed, and the default of
 * every visible empty field written in, so the backend reads exactly what the panel shows (a default
 * shown but not sent could differ from CardConfig's own default). Repeats until stable, because a
 * written default can show or hide other fields.
 */
export function normalize(d: FamilyDescriptor, draft: CardConfigJson, kinds: ScenarioKinds): CardConfigJson {
  let current: object = draft;
  for (let i = 0; i < 8; i += 1) {
    let next = pruneHidden(d, current, kinds);
    for (const f of visibleFields(d, next, kinds)) {
      if (f.default !== undefined && f.default !== null && getPath(next, f.path) === undefined) next = setPath(next, f.path, f.default);
    }
    if (JSON.stringify(next) === JSON.stringify(current)) break;
    current = next;
  }
  return current as CardConfigJson;
}

/** The context a draft card reads: its own anchor / comparison survey, or its chosen surveys as the rounds. */
export function cardContext(draft: CardConfigJson, ctx: StateContext): StateContext {
  const surveys = (draft.surveys ?? []).filter((s) => ctx.rounds.includes(s));
  const own = (name: string | null | undefined) => (name && ctx.rounds.includes(name) ? name : undefined);
  const anchor = surveys.length === 1 ? surveys[0] : own(draft.anchor_round);
  const next: StateContext = { ...ctx };
  if (surveys.length > 1) { next.rounds = surveys; next.anchor_round = surveys[surveys.length - 1]; }
  else if (anchor) next.anchor_round = anchor;
  const compare = own(draft.compare_round);
  if (compare) next.compare_round = compare;
  return next;
}
