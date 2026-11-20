import type { CardConfigJson, FieldDescriptor, OptionItem, StateContext } from "../../api/types";

/** What every widget receives: its field, the current value, the whole draft (for option lists) and the context. */
export interface WidgetProps<V = unknown> {
  field: FieldDescriptor;
  value: V;
  onChange(value: V | undefined): void;
  draft: CardConfigJson;
  ctx: StateContext;
  error?: string;
}

export const asParams = (field: FieldDescriptor): Record<string, string> =>
  Object.fromEntries(Object.entries(field.options?.params ?? {}).map(([k, v]) => [k, String(v)]));

/** An option's label, with the reason when it cannot be picked. */
export const optionLabel = (o: OptionItem): string => (o.disabled_reason ? `${o.label} (${o.disabled_reason})` : o.label);

const KIND_GROUPS: Record<string, string> = { party: "Party questions", opinion: "Opinion questions" };
const SCOPE_GROUPS: Record<string, string> = { respondent: "Respondent fields", seat: "Seat fields" };

/** Heading of an option's group: questions by kind, fields by what they describe; none for a plain list. */
export const groupOf = (o: OptionItem): string | null =>
  (o.kind !== null && o.kind !== undefined ? KIND_GROUPS[o.kind] : undefined)
  ?? (o.scope !== null && o.scope !== undefined ? SCOPE_GROUPS[o.scope] : undefined) ?? null;

/** An option's label with its marks: recalled and seat ones say so, an unavailable one says why. */
export const markedLabel = (o: OptionItem): string => {
  const marks = [o.recalled ? "recalled" : null, o.scope === "seat" ? "seat" : null, o.disabled_reason].filter((m) => m !== null);
  return marks.length > 0 ? `${o.label} (${marks.join(", ")})` : o.label;
};

/** Options kept in the order given, collected under their group headings (first seen first). */
export function grouped(items: OptionItem[]): { heading: string | null; items: OptionItem[] }[] {
  const out: { heading: string | null; items: OptionItem[] }[] = [];
  for (const o of items) {
    const heading = groupOf(o);
    const bucket = out.find((g) => g.heading === heading);
    if (bucket) bucket.items.push(o);
    else out.push({ heading, items: [o] });
  }
  return out;
}

/** Mantine select data for a list: grouped when any option has a group, flat otherwise. */
export function selectData(items: OptionItem[]) {
  const groups = grouped(items);
  const row = (o: OptionItem) => ({ value: o.value, label: markedLabel(o), disabled: o.disabled_reason !== null });
  return groups.every((g) => g.heading === null)
    ? items.map(row)
    : groups.map((g) => (g.heading === null ? g.items.map(row) : { group: g.heading, items: g.items.map(row) })).flat();
}
