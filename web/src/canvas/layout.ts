import { cloneLayout, verticalCompactor, type LayoutItem } from "react-grid-layout/core";
import { isBenchmarkFamily, isRankingFamily, isRelationshipFamily, type Family } from "../api/types";

/** A card's place on the canvas: grid columns and rows. Display state only; the engine never sees it. */
export interface Item { cardId: string; x: number; y: number; w: number; h: number }

export const COLUMNS = 12;
/** Pixel height of one grid row; the gap between rows comes from the theme. */
export const ROW_HEIGHT = 40;
export const SIZE_PRESETS = { small: 4, medium: 6, wide: 8, full: 12 } as const;
export type SizePreset = keyof typeof SIZE_PRESETS;
export type Direction = "left" | "right" | "up" | "down";

/** Wide tables get the full width; grid and ranking cards start narrower. */
export function defaultSize(family: Family): { w: number; h: number } {
  if (isBenchmarkFamily(family) || isRelationshipFamily(family)) return { w: 12, h: 10 };
  if (isRankingFamily(family)) return { w: 6, h: 10 };
  return { w: 8, h: 8 };
}

const FALLBACK = defaultSize("distribution");
const whole = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(n)));

/** Stored layouts can be hand-edited or from another version: clamp every value into the grid. */
export function normalise(item: Item): Item {
  const finite = [item.x, item.y, item.w, item.h].every(Number.isFinite);
  if (!finite) return { cardId: item.cardId, x: 0, y: 0, w: FALLBACK.w, h: FALLBACK.h };
  const w = whole(item.w, 1, COLUMNS);
  return { cardId: item.cardId, w, h: whole(item.h, 1, Number.MAX_SAFE_INTEGER), x: whole(item.x, 0, COLUMNS - w), y: whole(item.y, 0, Number.MAX_SAFE_INTEGER) };
}

const toLayout = (items: Item[]): LayoutItem[] => items.map((i) => ({ i: i.cardId, x: i.x, y: i.y, w: i.w, h: i.h }));
const fromLayout = (layout: readonly LayoutItem[]): Item[] => layout.map((l) => ({ cardId: l.i, x: l.x, y: l.y, w: l.w, h: l.h }));

/** Vertical compaction with the library's own rules, so keyboard actions and dragging agree. */
export function settle(items: Item[]): Item[] {
  return fromLayout(verticalCompactor.compact(cloneLayout(toLayout(items)), COLUMNS));
}

const free = (items: Item[], x: number, y: number, w: number, h: number): boolean =>
  items.every((i) => x + w <= i.x || i.x + i.w <= x || y + h <= i.y || i.y + i.h <= y);

/** The first spot, scanning rows top to bottom and columns left to right, where a card of this size fits. */
export function firstFreeSpot(items: Item[], size: { w: number; h: number }): { x: number; y: number } {
  const w = Math.min(size.w, COLUMNS);
  const bottom = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  for (let y = 0; y <= bottom; y += 1) {
    for (let x = 0; x + w <= COLUMNS; x += 1) if (free(items, x, y, w, size.h)) return { x, y };
  }
  return { x: 0, y: bottom };
}

const STEP: Record<Direction, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

/** One column or row in a direction, clamped to the grid; whatever is in the way is pushed, never overlapped. */
export function moveBy(items: Item[], cardId: string, dir: Direction): Item[] {
  const target = items.find((i) => i.cardId === cardId);
  if (target === undefined) return items;
  const [dx, dy] = STEP[dir];
  const x = whole(target.x + dx, 0, COLUMNS - target.w);
  const y = Math.max(0, target.y + dy);
  // Pin the moved card at its new spot so the others flow around it (fixing the order), then close the gaps.
  const pinned = toLayout(items).map((l) => (l.i === cardId ? { ...l, x, y, static: true } : l));
  const around = verticalCompactor.compact(cloneLayout(pinned), COLUMNS);
  return settle(fromLayout(around));
}

/** A preset width; the card is kept inside the grid and neighbours are pushed down. */
export function resizeTo(items: Item[], cardId: string, preset: SizePreset): Item[] {
  const w = SIZE_PRESETS[preset];
  return settle(items.map((i) => (i.cardId === cardId ? { ...i, w, x: Math.min(i.x, COLUMNS - w) } : i)));
}

/** A height in rows (at least one); neighbours are pushed down. */
export function fitHeight(items: Item[], cardId: string, rows: number): Item[] {
  const h = Math.max(1, Math.round(rows));
  return settle(items.map((i) => (i.cardId === cardId ? { ...i, h } : i)));
}

/** Rows top to bottom, then columns left to right: the order of the one-column layout. */
export function readingOrder(items: Item[]): Item[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** The fewest rows whose height (rows of ROW_HEIGHT with `gap` between them) holds `px` of content. */
export function rowsFor(px: number, gap: number): number {
  return Math.max(1, Math.ceil((px + gap) / (ROW_HEIGHT + gap)));
}
