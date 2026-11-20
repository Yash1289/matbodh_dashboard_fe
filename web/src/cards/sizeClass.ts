export type SizeClass = "narrow" | "medium" | "wide";

export const NARROW_BELOW = 420;
export const WIDE_FROM = 720;

/** The size class of a card from its own width (not the window's), so a canvas can resize it freely. */
export function sizeClass(width: number): SizeClass {
  if (width < NARROW_BELOW) return "narrow";
  return width < WIDE_FROM ? "medium" : "wide";
}
