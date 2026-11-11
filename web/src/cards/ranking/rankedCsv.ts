import type { RankedPayload } from "../../api/types";
import { csvField } from "../../table/csv";
import type { rankedRows } from "./rankedRows";

const num = (n: number | null): string => (n === null ? "" : String(n));
const slug = (s: string): string => s.replace(/ /g, "_");

/**
 * The rows as shown (search and sort applied): the engine's rank and value per round at full
 * precision. An absent slot writes its reason in the rank column and nothing in the value column,
 * so a missing rank is never read as zero.
 */
export function rankedToCsv(p: RankedPayload, model: ReturnType<typeof rankedRows>): string {
  const labelKeys = [...new Set(p.entities.flatMap((e) => Object.keys(e.labels)))];
  const label = (obs: string) => p.rounds.items.find((i) => i.obs_id === obs)?.label ?? obs;
  const header = ["group", ...labelKeys,
    ...model.rounds.flatMap((r) => [`rank_${slug(label(r))}`, `value_${slug(label(r))}`])];
  const lines = [header.map(csvField).join(",")];
  for (const { group, rows } of model.groups) {
    const partition = Object.values(group.partition).map((v) => v ?? "").join(" · ");
    for (const row of rows) {
      const out = [partition, ...labelKeys.map((k) => row.entity.labels[k] ?? "")];
      for (const slot of row.slots) {
        if (slot.kind === "absent") out.push(slot.reason, "");
        else out.push(num(slot.rank), num(slot.value));
      }
      lines.push(out.map(csvField).join(","));
    }
  }
  return lines.join("\r\n");
}
