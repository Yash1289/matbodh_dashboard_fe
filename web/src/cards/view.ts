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
}

export const ruleOf = (v: FamilyView): FormatRule =>
  v.format === "none" ? { kind: "none" } : { kind: v.format, within: v.within };

export const cutLabel = (dimensions: string[]): string => (dimensions.length ? dimensions.join(" · ") : "Overall");

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
