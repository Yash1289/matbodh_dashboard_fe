/**
 * The Configure dialog edits Split by as a model and keeps the card's `cuts` list (a list of tables, each a list of
 * fields) as the stored form, so nothing in the engine request changes:
 *  - `seat`: View by a seat attribute; it starts every table, and the card reads one value of it at a time;
 *  - `overall`: the table with no split;
 *  - `items`: a nested item `a › b › c` is the tables [a], [a,b], [a,b,c]; a flat item is exactly one table.
 */
export interface CutItem { fields: string[]; nested: boolean }
export interface CutModel { seat: string | null; overall: boolean; items: CutItem[] }

const key = (cut: string[]) => cut.join("\u0000");
const startsWith = (cut: string[], prefix: string[]) => prefix.every((f, i) => cut[i] === f);

export function writeCuts(model: CutModel): string[][] {
  const lead = model.seat === null ? [] : [model.seat];
  const tables: string[][] = model.overall ? [[...lead]] : [];
  for (const { fields, nested } of model.items) {
    if (nested) fields.forEach((_, i) => tables.push([...lead, ...fields.slice(0, i + 1)]));
    else tables.push([...lead, ...fields]);
  }
  const seen = new Set<string>();
  return tables.filter((t) => !seen.has(key(t)) && seen.add(key(t)));
}

export function readCuts(cuts: string[][], isSeat: (field: string) => boolean): CutModel {
  const crossedSeat = cuts.find((c) => c.length >= 2 && isSeat(c[0]))?.[0];
  // A seat field that starts every table is the View by; so is a seat table standing alone (no Overall beside it).
  const lone = cuts.length > 0 && cuts.every((c) => c.length === 1 && c[0] === cuts[0][0] && isSeat(c[0])) ? cuts[0][0] : undefined;
  const seat = lone ?? (crossedSeat !== undefined && cuts.every((c) => c[0] === crossedSeat) ? crossedSeat : null);
  const tables = seat === null ? cuts : cuts.map((c) => c.slice(1));
  const overall = tables.some((c) => c.length === 0);
  const seenTables = new Set<string>();
  const present = tables.filter((c) => c.length > 0 && !seenTables.has(key(c)) && seenTables.add(key(c)));
  const has = new Set(present.map(key));
  // A nested item is a longest table whose every parent table is also present.
  const longest = present.filter((c) => !present.some((d) => d.length > c.length && startsWith(d, c)));
  const chains = longest.filter((c) => c.length > 1 && c.every((_, i) => has.has(key(c.slice(0, i + 1)))));
  const emitted = new Set<string>();
  const items: CutItem[] = [];
  for (const c of present) {
    const chain = chains.find((m) => startsWith(m, c));
    if (chain === undefined) items.push({ fields: c, nested: false });
    else if (!emitted.has(key(chain))) {
      emitted.add(key(chain));
      items.push({ fields: chain, nested: true });
    }
  }
  return { seat, overall, items };
}
