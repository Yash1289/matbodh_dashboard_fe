import type { Cell, RoundsBlock } from "../api/types";
import type { CellGrid, GridCell } from "./grid";

const field = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const num = (n: number | null | undefined): string => (n === null || n === undefined ? "" : String(n));
const slug = (s: string): string => s.replace(/ /g, "_");

interface CsvColumn { key: string; source: string; pick: (gc: GridCell | undefined) => Cell | null }

/** The merged seats column goes back to separate AC and PC columns: no level is lost. */
const csvColumns = (g: CellGrid): CsvColumn[] =>
  g.columns.flatMap((c) =>
    c.key === "seats"
      ? [{ key: "seats_ac", source: c.key, pick: (gc) => gc?.cell ?? null }, { key: "seats_pc", source: c.key, pick: (gc) => gc?.pcCell ?? null }]
      : [{ key: c.key, source: c.key, pick: (gc) => gc?.cell ?? null }],
  );

/** Raw engine numbers at full precision; null is an empty field. */
export function toCsv(g: CellGrid, rounds: RoundsBlock): string {
  const name = (obsId: string): string => slug(rounds.items.find((r) => r.obs_id === obsId)?.base_name ?? obsId);
  const withDelta = rounds.compare !== null;
  const header = ["row"];
  const columns = csvColumns(g);
  for (const c of columns) {
    for (const r of rounds.items) header.push(`${c.key}_${slug(r.base_name)}`);
    if (withDelta) header.push(`delta_${c.key}_${name(rounds.anchor)}_vs_${name(rounds.compare!)}`);
    header.push(`base_${c.key}`, `flags_${c.key}`);
  }
  const lines = [header.map(field).join(",")];
  for (const r of g.rows) {
    const out = [r.label];
    for (const c of columns) {
      const cell = c.pick(g.cells[r.key]?.[c.source]);
      rounds.items.forEach((_, i) => out.push(num(cell?.trend[i])));
      if (withDelta) out.push(num(cell?.delta));
      out.push(num(cell?.base), (cell?.flags ?? []).join(";"));
    }
    lines.push(out.map(field).join(","));
  }
  return lines.join("\r\n");
}
