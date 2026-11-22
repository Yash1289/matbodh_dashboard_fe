import type { Cut, GridPayload } from "../api/types";

export type FieldScope = "seat" | "respondent" | null;

/**
 * A crossed cut whose first field describes the seat (a zone, an AC, an incumbent's party) is read one
 * seat group at a time: that field becomes a selector and the table shows the fields after it.
 * Only the first field is ever the selector, and a seat field on its own stays as plain rows.
 */
export function seatSplit(dimensions: string[], scopes: Record<string, FieldScope>): { field: string; rest: string[] } | null {
  if (dimensions.length < 2 || scopes[dimensions[0]] !== "seat") return null;
  return { field: dimensions[0], rest: dimensions.slice(1) };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const labelOf = (field: string) => (r: Cut["rows"][number]) => r.labels[field] ?? null;

export interface SeatChoices {
  field: string;
  /** The seat field's values, in the order the engine returned them. */
  values: string[];
  /** The engine's own table over the remaining fields (every seat together), when the card asked for one. */
  all: Cut | null;
}

export function seatChoices(payload: GridPayload, cut: Cut, field: string): SeatChoices {
  const seen = new Set<string>();
  for (const r of cut.rows) {
    const v = labelOf(field)(r);
    if (v !== null) seen.add(v);
  }
  const rest = cut.dimensions.filter((d) => d !== field);
  return { field, values: [...seen], all: payload.cuts.find((c) => c.id !== cut.id && sameSet(c.dimensions, rest)) ?? null };
}

/** `null` means All. Without a usable choice: All when the engine has it, else the first seat value. */
export function resolveSeat(choices: SeatChoices, chosen: string | null | undefined): string | null {
  const fallback = choices.all !== null ? null : (choices.values[0] ?? null);
  if (chosen === undefined) return fallback;
  if (chosen === null) return choices.all !== null ? null : fallback;
  return choices.values.includes(chosen) ? chosen : fallback;
}

/** The payload with the given cut narrowed to one seat value (or swapped for the engine's All table). */
export function applySeat(payload: GridPayload, cutId: string, field: string, seat: string | null): GridPayload {
  const cut = payload.cuts.find((c) => c.id === cutId);
  if (!cut || !cut.dimensions.includes(field)) return payload;
  let shown: Cut;
  if (seat === null) {
    const all = seatChoices(payload, cut, field).all;
    if (all === null) return payload;
    shown = { ...all, id: cut.id };
  } else {
    const rows = cut.rows
      .filter((r) => labelOf(field)(r) === seat)
      .map((r) => {
        const { [field]: _gone, ...labels } = r.labels;
        return { ...r, labels, subtotal: r.subtotal.filter((s) => s !== field) };
      });
    const keys = new Set(rows.map((r) => r.key));
    shown = {
      ...cut,
      dimensions: cut.dimensions.filter((d) => d !== field),
      rows,
      cells: cut.cells.filter((c) => keys.has(c.row)),
      deltas: cut.deltas.filter((d) => keys.has(d.row)),
      bases: cut.bases.filter((b) => keys.has(b.row)),
    };
  }
  return { ...payload, cuts: payload.cuts.map((c) => (c.id === cutId ? shown : c)) };
}

/**
 * The seat field every table of the card starts with (a View by), or null. Only a seat-scope field counts, and a
 * table that does not start with it (the Overall table) is left out of the check.
 */
export function seatChain(cuts: Cut[], scopes: Record<string, FieldScope>): string | null {
  const tables = cuts.filter((c) => c.dimensions.length > 0);
  const lead = tables[0]?.dimensions[0];
  return lead !== undefined && scopes[lead] === "seat" && tables.every((c) => c.dimensions[0] === lead) ? lead : null;
}

const without = (key: string, field: string): string => {
  const kept = key.split("|").filter((part) => !part.startsWith(`${field}=`)).join("|");
  return kept === "" ? "overall" : kept;
};

/**
 * Every table narrowed to one seat value, with the seat part removed from its row keys, so the tables read as a
 * plain chain (a seat-only table becomes the Overall row). Shares and bases follow their rows.
 */
export function narrowChain(payload: GridPayload, field: string, seat: string): GridPayload {
  const cuts = payload.cuts.map((cut) => {
    if (cut.dimensions[0] !== field) return cut;
    const keep = new Map<string, string>();
    const rows = cut.rows.filter((r) => labelOf(field)(r) === seat).map((r) => {
      const key = without(r.key, field);
      keep.set(r.key, key);
      const { [field]: _gone, ...labels } = r.labels;
      return { ...r, key, labels, subtotal: r.subtotal.filter((s) => s !== field) };
    });
    const rekey = <T extends { row: string }>(xs: T[] | undefined): T[] =>
      (xs ?? []).filter((x) => keep.has(x.row)).map((x) => ({ ...x, row: keep.get(x.row)! }));
    return { ...cut, dimensions: cut.dimensions.slice(1), rows, cells: rekey(cut.cells), deltas: rekey(cut.deltas), bases: rekey(cut.bases), population: rekey(cut.population) };
  });
  return { ...payload, cuts };
}
