import { useMemo } from "react";
import type { CellPart, GridPayload, PresentationRules } from "../../../api/types";
import { partsFor } from "../../../cells/parts";
import { CompositeTable } from "../../../table/CompositeTable";
import { applyPresentationRules, transpose, type Header } from "../../../table/grid";
import { payloadToGrid } from "../../grid/payloadToGrid";
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
    let g = payloadToGrid(payload, { lens: view.lens, cut: view.cut });
    if (view.hidden.length > 0) {
      const gone = new Set(view.hidden);
      g = { ...g, columns: g.columns.filter((c) => !gone.has(c.key)) };
    }
    const query = view.search.trim().toLowerCase();
    if (query) g = { ...g, rows: g.rows.filter((r) => r.label.toLowerCase().includes(query)) };
    g = applyPresentationRules(g, merged, columnName, rowName);
    return view.transposed ? transpose(g) : g;
  }, [payload, view.lens, view.cut, view.hidden, view.search, view.transposed, merged]);

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
