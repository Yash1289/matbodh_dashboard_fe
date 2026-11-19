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
