import type { Condition, FamilyDescriptor, FieldDescriptor } from "../api/types";

/** Scenario id -> "party" | "opinion" | "recalled" (a recalled scenario is a party scenario). */
export type ScenarioKinds = Record<string, string>;
type Draft = Record<string, unknown>;

const isObject = (v: unknown): v is Draft => typeof v === "object" && v !== null && !Array.isArray(v);

/** Dotted path into the draft; a numeric part indexes a list ("scenarios.0"). Missing = undefined. */
export function getPath(draft: object, path: string): unknown {
  let node: unknown = draft;
  for (const part of path.split(".")) {
    if (Array.isArray(node)) node = /^\d+$/.test(part) ? node[Number(part)] : undefined;
    else if (isObject(node)) node = node[part];
    else return undefined;
  }
  return node;
}

/** A copy of the draft with `value` at `path`; parents that do not exist are created. */
export function setPath(draft: object, path: string, value: unknown): object {
  const [head, ...rest] = path.split(".");
  const base = draft as Draft;
  if (rest.length === 0) return { ...base, [head]: value };
  const child = isObject(base[head]) ? (base[head] as object) : {};
  return { ...base, [head]: setPath(child, rest.join("."), value) };
}

/** A copy without the value at `path`; an object left empty by it is removed too (never `{}` leftovers). */
function deletePath(draft: object, path: string): object {
  const [head, ...rest] = path.split(".");
  const base = { ...(draft as Draft) };
  if (!(head in base)) return base;
  if (rest.length === 0) {
    delete base[head];
    return base;
  }
  if (!isObject(base[head])) return base;
  const child = deletePath(base[head] as object, rest.join("."));
  if (Object.keys(child).length === 0) delete base[head];
  else base[head] = child;
  return base;
}

const nonempty = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v !== "" : v !== undefined && v !== null;

export function evaluate(c: Condition, draft: object, kinds: ScenarioKinds): boolean {
  switch (c.op) {
    case "equals": return getPath(draft, c.path) === c.value;
    case "in": return c.values.some((v) => v === getPath(draft, c.path));
    case "nonempty": return nonempty(getPath(draft, c.path));
    case "contains": {
      const found = getPath(draft, c.path);
      return Array.isArray(found) && found.some((item) => (Array.isArray(item) ? item.includes(c.value) : item === c.value));
    }
    case "kind_of": {
      const scenario = getPath(draft, c.path);
      const kind = typeof scenario === "string" ? kinds[scenario] : undefined;
      if (kind === undefined) return false;
      return c.kind === "party" ? kind === "party" || kind === "recalled" : kind === c.kind;
    }
    case "count_at_least": {
      const found = getPath(draft, c.path);
      return Array.isArray(found) && found.length >= c.n;
    }
    case "all": return c.of.every((x) => evaluate(x, draft, kinds));
    case "any": return c.of.some((x) => evaluate(x, draft, kinds));
    case "not": return !evaluate(c.of, draft, kinds);
  }
}

const shown = (f: FieldDescriptor, draft: object, kinds: ScenarioKinds): boolean =>
  f.show_when === undefined || evaluate(f.show_when, draft, kinds);

export const visibleFields = (d: FamilyDescriptor, draft: object, kinds: ScenarioKinds): FieldDescriptor[] =>
  d.fields.filter((f) => shown(f, draft, kinds));

/** The draft without the values of hidden fields; repeats until stable, since one removal can hide another. */
export function pruneHidden(d: FamilyDescriptor, draft: object, kinds: ScenarioKinds): object {
  let current = draft;
  for (;;) {
    const hidden = d.fields.filter((f) => !shown(f, current, kinds) && getPath(current, f.path) !== undefined);
    if (hidden.length === 0) return current;
    current = hidden.reduce<object>((acc, f) => deletePath(acc, f.path), current);
  }
}
