import { useMemo } from "react";
import type { CellPart, GridPayload, PresentationRules } from "../../../api/types";
import { partsFor } from "../../../cells/parts";
import { CompositeTable } from "../../../table/CompositeTable";
import { applyPresentationRules, transpose, type Header } from "../../../table/grid";
import { gridFor, keepWithAncestors } from "../../grid/cascade";
import { ruleOf, type FamilyView } from "../../view";

export interface GridBodyProps {
  payload: GridPayload;
  view: FamilyView;
  onView: (patch: Partial<FamilyView>) => void;
  /** State presentation rules (GET /api/presentation/{state}). */
  rules?: PresentationRules | null;
  /** Card-level ordering and colours; each overrides the matching state rule. */
  order?: { rows?: string[]; columns?: string[]; pinLast?: string[] };
  colors?: Record<string, string>;
}

// Payload columns are "scenario:party" and rows "dimension=value"; rules name the bare party or value.
const columnName = (h: Header): string => (h.key.includes(":") ? h.key.slice(h.key.lastIndexOf(":") + 1) : h.key);
const rowName = (h: Header): string => (h.key.includes("=") && !h.key.includes("|") ? h.key.slice(h.key.indexOf("=") + 1) : h.key);

/** The grid card body: pure display over the received payload, so nothing here fetches. */
export function GridBody({ payload, view, onView, rules, order, colors }: GridBodyProps) {
  const merged = useMemo<PresentationRules>(() => ({
    ...rules,
    ...(order?.rows ? { rowOrder: order.rows } : {}),
    ...(order?.columns ? { columnOrder: order.columns } : {}),
    ...(order?.pinLast ? { pinLast: order.pinLast } : {}),
    entityColors: { ...rules?.entityColors, ...colors },
  }), [rules, order, colors]);

  const grid = useMemo(() => {
    const tree = view.density === "cascaded";
    let g = gridFor(payload, { lens: view.lens, cut: view.cut, density: view.density });
    if (view.hidden.length > 0) {
      const gone = new Set(view.hidden);
      g = { ...g, columns: g.columns.filter((c) => !gone.has(c.key)) };
    }
    const query = view.search.trim().toLowerCase();
    const matches = (r: Header) => r.label.toLowerCase().includes(query);
    if (query) g = { ...g, rows: tree ? keepWithAncestors(g.rows, matches) : g.rows.filter(matches) };
    // A tree keeps the order its parents and children came in; rules still order its columns.
    g = applyPresentationRules(g, tree ? { ...merged, rowOrder: undefined } : merged, columnName, rowName);
    return view.transposed && !tree ? transpose(g) : g;
  }, [payload, view.lens, view.cut, view.density, view.hidden, view.search, view.transposed, merged]);

  const parts = useMemo<CellPart[]>(() => {
    const allowed: CellPart[] = payload.mode === "compare" ? ["value", "delta"] : ["value"];
    const base = partsFor(view.preset, view.density, allowed);
    return view.showDetails ? [...new Set<CellPart>([...base, "base", "flags"])] : base;
  }, [payload.mode, view.preset, view.density, view.showDetails]);

  return (
    <CompositeTable grid={grid} parts={parts} rounds={payload.rounds} rule={ruleOf(view)}
      sort={view.sort} onSort={(sort) => onView({ sort })} />
  );
}
