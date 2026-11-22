import type { GridDensity, GridPayload } from "../api/types";
import type { ShowPreset } from "../cells/parts";
import type { FormatRule } from "../table/formatRules";
import type { SortSpec } from "../table/grid";
import { cascadable } from "./grid/cascade";

export type Within = Extract<FormatRule, { kind: "heat" }>["within"];

/** Display state of one card. Changing any of it is in-memory: it never starts a request. */
export interface FamilyView {
  lens: string;
  cut: string;
  preset: ShowPreset;
  density: GridDensity;
  transposed: boolean;
  format: FormatRule["kind"];
  within: Within;
  sort: SortSpec | null;
  search: string;
  hidden: string[];
  showDetails: boolean;
  /** The chosen seat group when the cut's first field is a seat field: a value, or null for All. Unset means the default. */
  seat?: string | null;
  /** Several surveys / questions / parties are read one at a time: the chosen one (unset = the first). Display only. */
  survey?: string | null;
  question?: string | null;
  party?: string | null;
}

export const ruleOf = (v: FamilyView): FormatRule =>
  v.format === "none" ? { kind: "none" } : { kind: v.format, within: v.within };

export const cutLabel = (dimensions: string[]): string => (dimensions.length ? dimensions.join(" · ") : "Overall");

/**
 * Repairs a chosen view against a (possibly new) payload: a cut or lens the payload no
 * longer has falls back to its default, and a sort, hidden column or diverging format that
 * no longer applies is dropped. Returns the same object when nothing needs repair.
 */
export function settled(view: FamilyView, payload: GridPayload, seatFields?: ReadonlySet<string>): FamilyView {
  const found = cascadable(payload.cuts, seatFields);
  const wanted = view.density === "cascaded" && found.ok ? found.chain[0].id : view.cut;
  const cut = payload.cuts.some((c) => c.id === wanted) ? wanted : (payload.cuts[0]?.id ?? "");
  const lens = payload.meta.lenses.some((l) => l.id === view.lens) ? view.lens : payload.meta.default_lens;
  const keys = new Set(payload.columns.map((c) => c.key));
  const lensUnit = payload.meta.lenses.find((l) => l.id === lens)?.unit;
  const divergingOk = payload.mode === "compare" || lensUnit === "percentage_points";
  // A tree is one table over the whole chain: it can neither be sorted nor transposed without losing its shape.
  const density = view.density === "cascaded" && !found.ok ? "standard" : view.density;
  const tree = density === "cascaded";
  const transposed = tree ? false : view.transposed;
  const sort = !tree && cut === view.cut && !transposed && view.sort && keys.has(view.sort.column) ? view.sort : null;
  const hidden = view.hidden.filter((k) => keys.has(k));
  const format = view.format === "diverging" && !divergingOk ? "none" : view.format;
  if (cut === view.cut && lens === view.lens && sort === view.sort
      && hidden.length === view.hidden.length && format === view.format
      && density === view.density && transposed === view.transposed) return view;
  return { ...view, cut, lens, sort, hidden, format, density, transposed };
}

/** The view a card starts in; a chip counts as "selected" when it differs from this. */
export function initialView(p: GridPayload, seatFields?: ReadonlySet<string>): FamilyView {
  const found = cascadable(p.cuts, seatFields);
  return {
    lens: p.meta.default_lens,
    // A tree is read from its first cut (an Overall cut before it would lay out the wrong table).
    cut: (found.ok && found.whole ? found.chain[0].id : p.cuts[0]?.id) ?? "",
    preset: p.mode === "compare" ? "both" : "share",
    density: found.ok && found.whole ? "cascaded" : "standard",
    transposed: false,
    format: p.mode === "compare" ? "diverging" : "none",
    within: "column",
    sort: null,
    search: "",
    hidden: [],
    showDetails: false,
  };
}
