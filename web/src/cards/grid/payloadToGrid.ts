import type { Cell, CellValue, DeltaValue, GridPayload, LensDef, Unit } from "../../api/types";
import { POP_KEY, type CellGrid, type GridCell, type Header } from "../../table/grid";

/** What the display controls pick from a payload; nothing here needs the network. */
/** `cascade` maps each row key of a cascaded cut to its depth. */
export interface GridView { lens: string; cut: string; cascade?: Record<string, number> }

const SEP = "\u0000";
// The sample size comes first: a weight mass reads as a nonsense "n".
const BASE_FIELDS = ["unweighted_base", "population_raw_base", "weighted_denominator"] as const;
const unitOf = (lens: LensDef): Unit => (lens.unit === "percentage_points" ? "pp" : "pct");
const statusFlags = (status: string | undefined): string[] =>
  status === undefined || status === "available" ? [] : [status];
const unique = (flags: string[]): string[] => [...new Set(flags)];

function rowLabel(key: string, labels: Record<string, string | null>): string {
  if (key === "overall") return "Overall";
  return Object.values(labels).map((label) => label ?? "(no value)").join(" · ");
}

/**
 * Pivot one cut of an engine payload into the table's CellGrid. Every number is copied
 * from the payload: the engine owns the arithmetic, the browser never adds or subtracts.
 */
export function payloadToGrid(p: GridPayload, view: GridView): CellGrid {
  const cut = p.cuts.find((c) => c.id === view.cut);
  if (!cut) throw new Error(`Unknown cut ${view.cut}`);
  const lens = p.meta.lenses.find((l) => l.id === view.lens)
    ?? p.meta.lenses.find((l) => l.id === p.meta.default_lens)
    ?? p.meta.lenses[0];
  const unit = unitOf(lens);
  const columns = p.columns.filter((c) => c.lenses === null || c.lenses.includes(lens.id));

  const items = p.rounds.items;
  const labelOf = (obs: string) => items.find((i) => i.obs_id === obs)?.label ?? obs;
  const cellKey = (row: string, column: string, round: string | null) => `${row}${SEP}${column}${SEP}${round ?? ""}`;
  const values = new Map<string, CellValue>();
  for (const c of cut.cells) if (c.lens === lens.id) values.set(cellKey(c.row, c.column, c.round), c);
  const deltas = new Map<string, DeltaValue>();
  for (const d of cut.deltas) if (d.lens === lens.id) deltas.set(`${d.row}${SEP}${d.column}`, d);
  // The cell's base for the details view: the first base the engine reported for it.
  const bases = new Map<string, number>();
  for (const b of cut.bases) {
    const found = BASE_FIELDS.map((f) => b.fields[f]).find((v): v is number => typeof v === "number");
    if (found !== undefined) bases.set(cellKey(b.row, b.column, b.round), found);
  }

  const mode = p.mode;
  const cutRounds = [...new Set(cut.cells.map((c) => c.round).filter((r): r is string => r !== null))];
  const valueRound = cutRounds.includes(p.rounds.anchor) ? p.rounds.anchor : (cutRounds[0] ?? p.rounds.anchor);
  const roundIds = mode === "trend" ? items.map((i) => i.obs_id) : [valueRound];
  const roundLabels = roundIds.map(labelOf);
  const notAsked = new Set(
    p.not_asked.flatMap((n) => n.rounds).map((name) => items.find((i) => i.base_name === name || i.obs_id === name)?.obs_id)
      .filter((o): o is string => o !== undefined),
  );

  const cells: CellGrid["cells"] = {};
  for (const row of cut.rows) {
    cells[row.key] = {};
    for (const column of columns) {
      // A compare cell whose target has no value still carries the engine delta and its reason.
      const has = roundIds.some((round) => values.has(cellKey(row.key, column.key, round)))
        || (mode === "compare" && deltas.has(`${row.key}${SEP}${column.key}`));
      if (!has) {
        cells[row.key][column.key] = { cell: null, unit };
        continue;
      }
      let gridCell: GridCell;
      if (mode === "trend") {
        const per = roundIds.map((round) => values.get(cellKey(row.key, column.key, round)));
        const trend = per.map((cv) => cv?.value ?? null);
        const roundFlags = per.map((cv, i) => {
          const flags = statusFlags(cv?.status);
          if (cv === undefined) flags.push(notAsked.has(roundIds[i]) ? "not_asked" : "null_value");
          return flags;
        });
        const at = roundIds.indexOf(p.rounds.anchor);
        const cell: Cell = {
          value: trend[at >= 0 ? at : trend.length - 1], delta: null, trend, secondary: null,
          flags: unique(roundFlags.flat()), base: bases.get(cellKey(row.key, column.key, roundIds[at >= 0 ? at : roundIds.length - 1])) ?? null,
        };
        gridCell = { cell, unit, roundFlags };
      } else {
        const cv = values.get(cellKey(row.key, column.key, valueRound));
        const flags = statusFlags(cv?.status);
        let delta: number | null = null;
        if (mode === "compare") {
          const dv = deltas.get(`${row.key}${SEP}${column.key}`);
          if (dv) {
            delta = dv.value;
            flags.push(...statusFlags(dv.status));
          } else if (lens.has_delta) {
            flags.push("no_delta");
          }
        }
        gridCell = {
          cell: {
            value: cv?.value ?? null, delta, trend: [], secondary: null, flags: unique(flags),
            base: bases.get(cellKey(row.key, column.key, valueRound)) ?? null,
          },
          unit,
        };
      }
      cells[row.key][column.key] = gridCell;
    }
  }

  const population = new Map((cut.population ?? []).map((x) => [x.row, x]));
  const showPop = p.meta.capabilities.population === true;
  if (showPop) {
    for (const row of cut.rows) {
      const x = population.get(row.key);
      cells[row.key][POP_KEY] = {
        cell: x ? { value: x.value, delta: null, trend: [], secondary: null, flags: statusFlags(x.status), base: null } : null,
        unit: "pct",
      };
    }
  }

  const multiScenario = new Set(columns.map((c) => c.scenario)).size > 1;
  const headers: Header[] = columns.map((c) => {
    const sub = [multiScenario && c.scenario !== c.label ? c.scenario : null, mode === "trend" ? roundLabels.join(" | ") : null]
      .filter((s): s is string => s !== null).join(" · ");
    return { key: c.key, label: c.label, colour: c.colour, ...(sub ? { sub } : {}) };
  });
  if (showPop) headers.unshift({ key: POP_KEY, label: "Pop %", colour: null });
  const depthOf = view.cascade;
  const rows: Header[] = cut.rows.map((r) => {
    const depth = depthOf?.[r.key] ?? 0;
    // A child of a cascaded table is named by its own value; its parents are the rows above it.
    const own = Object.values(r.labels);
    const label = depth > 0 ? (own[own.length - 1] ?? "(no value)") : rowLabel(r.key, r.labels);
    return { key: r.key, label, colour: null, ...(depthOf ? { depth } : {}), ...(depth > 0 ? { path: rowLabel(r.key, r.labels) } : {}) };
  });

  const grid: CellGrid = {
    rows, columns: headers, cells,
    rowDim: p.layoutLabel ?? (cut.dimensions.length ? cut.dimensions.join(" · ") : "overall"),
    columnDim: columns[0]?.kind === "scale" ? "question" : (columns[0]?.kind ?? "series"),
    mode,
  };
  if (mode === "trend") grid.roundLabels = roundLabels;
  if (mode === "compare") {
    const delta = p.cuts.flatMap((c) => c.deltas)[0];
    if (delta) {
      const [targetObs] = delta.target.split(":");
      const [referenceObs, ...scenario] = delta.reference.split(":");
      // Round names are series-qualified outside the table's own column heads (spec principle 7).
      const fullName = (obs: string) => items.find((i) => i.obs_id === obs)?.base_name ?? labelOf(obs);
      grid.referenceLabel = referenceObs !== targetObs ? fullName(referenceObs) : scenario.join(":");
    }
  }
  return grid;
}
