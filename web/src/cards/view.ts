import type { Density, GridPayload } from "../api/types";
import type { ShowPreset } from "../cells/parts";
import type { FormatRule } from "../table/formatRules";
import type { SortSpec } from "../table/grid";

export type Within = Extract<FormatRule, { kind: "heat" }>["within"];

/** Display state of one card. Changing any of it is in-memory: it never starts a request. */
export interface FamilyView {
  lens: string;
  cut: string;
  preset: ShowPreset;
  density: Density;
  transposed: boolean;
  format: FormatRule["kind"];
  within: Within;
  sort: SortSpec | null;
  search: string;
  hidden: string[];
  showDetails: boolean;
  /** The chosen seat group when the cut's first field is a seat field: a value, or null for All. Unset means the default. */
  seat?: string | null;
}

export const ruleOf = (v: FamilyView): FormatRule =>
  v.format === "none" ? { kind: "none" } : { kind: v.format, within: v.within };

export const cutLabel = (dimensions: string[]): string => (dimensions.length ? dimensions.join(" · ") : "Overall");

/**
 * Repairs a chosen view against a (possibly new) payload: a cut or lens the payload no
 * longer has falls back to its default, and a sort, hidden column or diverging format that
 * no longer applies is dropped. Returns the same object when nothing needs repair.
 */
export function settled(view: FamilyView, payload: GridPayload): FamilyView {
  const cut = payload.cuts.some((c) => c.id === view.cut) ? view.cut : (payload.cuts[0]?.id ?? "");
  const lens = payload.meta.lenses.some((l) => l.id === view.lens) ? view.lens : payload.meta.default_lens;
  const keys = new Set(payload.columns.map((c) => c.key));
  const lensUnit = payload.meta.lenses.find((l) => l.id === lens)?.unit;
  const divergingOk = payload.mode === "compare" || lensUnit === "percentage_points";
  const sort = cut === view.cut && !view.transposed && view.sort && keys.has(view.sort.column) ? view.sort : null;
  const hidden = view.hidden.filter((k) => keys.has(k));
  const format = view.format === "diverging" && !divergingOk ? "none" : view.format;
  if (cut === view.cut && lens === view.lens && sort === view.sort
      && hidden.length === view.hidden.length && format === view.format) return view;
  return { ...view, cut, lens, sort, hidden, format };
}

/** The view a card starts in; a chip counts as "selected" when it differs from this. */
export function initialView(p: GridPayload): FamilyView {
  return {
    lens: p.meta.default_lens,
    cut: p.cuts[0]?.id ?? "",
    preset: p.mode === "compare" ? "both" : "share",
    density: "standard",
    transposed: false,
    format: p.mode === "compare" ? "diverging" : "none",
    within: "column",
    sort: null,
    search: "",
    hidden: [],
    showDetails: false,
  };
}
