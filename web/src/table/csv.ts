import type { CellGrid } from "./grid";

const field = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export { field as csvField };
const num = (n: number | null | undefined): string => (n === null || n === undefined ? "" : String(n));
const slug = (s: string): string => s.replace(/ /g, "_");

/**
 * Raw engine numbers at full precision; null is an empty field. A trend column has one value per
 * round, a compare column adds its engine delta, a standalone column is the value alone.
 */
export function toCsv(g: CellGrid): string {
  const rounds = g.mode === "trend" ? (g.roundLabels ?? []) : [];
  const withDelta = g.mode === "compare";
  const header = ["row"];
  for (const c of g.columns) {
    if (rounds.length > 0) rounds.forEach((r) => header.push(`${c.key}_${slug(r)}`));
    else header.push(c.key);
    if (withDelta) header.push(`delta_${c.key}`);
    header.push(`base_${c.key}`, `flags_${c.key}`);
  }
  const lines = [header.map(field).join(",")];
  for (const r of g.rows) {
    const out = [r.label];
    for (const c of g.columns) {
      const cell = g.cells[r.key]?.[c.key]?.cell;
      if (rounds.length > 0) rounds.forEach((_, i) => out.push(num(cell?.trend[i])));
      else out.push(num(cell?.value));
      if (withDelta) out.push(num(cell?.delta));
      out.push(num(cell?.base), (cell?.flags ?? []).join(";"));
    }
    lines.push(out.map(field).join(","));
  }
  return lines.join("\r\n");
}
