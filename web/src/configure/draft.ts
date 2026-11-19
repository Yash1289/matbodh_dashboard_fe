import type { CardConfigJson, FamilyDescriptor } from "../api/types";
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
