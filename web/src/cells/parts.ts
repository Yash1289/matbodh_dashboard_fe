import type { CellPart, Density, RoundsBlock } from "../api/types";

export type ShowPreset = "share" | "delta" | "both" | "both_trend";

const ORDER: CellPart[] = ["value", "delta", "trend", "base", "secondary", "flags"];
const PRESET_BASE: Record<ShowPreset, CellPart[]> = {
  share: ["value"],
  delta: ["delta"],
  both: ["value", "delta"],
  both_trend: ["value", "delta", "trend"],
};
const DETAIL_ONLY: CellPart[] = ["base", "secondary", "flags"];

export function partsFor(preset: ShowPreset, density: Density, allowed: CellPart[]): CellPart[] {
  let wanted = PRESET_BASE[preset];
  if (density === "compact") wanted = wanted.filter((p) => p !== "trend");
  if (density === "detailed") wanted = [...wanted, ...DETAIL_ONLY];
  const ok = new Set<CellPart>([...allowed, ...DETAIL_ONLY]);
  return ORDER.filter((p) => wanted.includes(p) && ok.has(p));
}

/** Trend indices at which the series group changes. */
export function seriesBreaks(rounds: RoundsBlock): number[] {
  const out: number[] = [];
  let n = 0;
  rounds.groups.forEach((g, i) => {
    if (i > 0) out.push(n);
    n += g.obs_ids.length;
  });
  return out;
}

const baseName = (rounds: RoundsBlock, obsId: string): string =>
  rounds.items.find((r) => r.obs_id === obsId)?.base_name ?? obsId;

export function deltaTitle(rounds: RoundsBlock): string | null {
  if (rounds.compare === null) return null;
  return `Δ ${baseName(rounds, rounds.anchor)} − ${baseName(rounds, rounds.compare)}`;
}
