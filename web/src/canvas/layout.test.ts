import { describe, expect, it } from "vitest";
import { COLUMNS, ROW_HEIGHT, defaultSize, firstFreeSpot, fitHeight, moveBy, normalise, readingOrder, resizeTo, rowsFor, settle, type Item } from "./layout";

const item = (cardId: string, x: number, y: number, w: number, h: number): Item => ({ cardId, x, y, w, h });
const byId = (items: Item[], id: string): Item => items.find((i) => i.cardId === id)!;

const overlaps = (a: Item, b: Item) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const noOverlap = (items: Item[]) => items.every((a, i) => items.slice(i + 1).every((b) => !overlaps(a, b)));

describe("firstFreeSpot", () => {
  it("puts the first card at 0,0", () => {
    expect(firstFreeSpot([], { w: 6, h: 4 })).toEqual({ x: 0, y: 0 });
  });

  it("skips occupied cells, scanning rows then columns", () => {
    const items = [item("a", 0, 0, 6, 4)];
    expect(firstFreeSpot(items, { w: 6, h: 4 })).toEqual({ x: 6, y: 0 });
    expect(firstFreeSpot(items, { w: 12, h: 4 })).toEqual({ x: 0, y: 4 });
  });

  it("fills a gap left by a smaller card before going below", () => {
    const items = [item("a", 0, 0, 4, 4), item("b", 8, 0, 4, 4)];
    expect(firstFreeSpot(items, { w: 4, h: 4 })).toEqual({ x: 4, y: 0 });
  });
});

describe("normalise", () => {
  it("clamps width, x, y and height into the grid", () => {
    expect(normalise(item("a", -3, -1, 40, 0))).toEqual(item("a", 0, 0, COLUMNS, 1));
    expect(normalise(item("a", 10, 2, 6, 3))).toEqual(item("a", 6, 2, 6, 3));
  });

  it("rounds fractions and replaces non-finite values with the default", () => {
    const d = defaultSize("distribution");
    expect(normalise(item("a", 1.6, 0, 4.2, 3.7))).toEqual(item("a", 2, 0, 4, 4));
    expect(normalise({ cardId: "a", x: Number.NaN, y: Number.NaN, w: Number.NaN, h: Number.NaN })).toEqual(item("a", 0, 0, d.w, d.h));
  });
});

describe("moveBy", () => {
  it("stays put at the grid edge", () => {
    const items = [item("a", 6, 0, 6, 4)];
    expect(byId(moveBy(items, "a", "right"), "a").x).toBe(6);
    expect(byId(moveBy(items, "a", "left"), "a").x).toBe(5);
  });

  it("pushes the other card out of the way instead of overlapping it", () => {
    const items = [item("a", 0, 0, 12, 4), item("b", 0, 4, 12, 4)];
    const moved = moveBy(items, "b", "up");
    expect(noOverlap(moved)).toBe(true);
    expect(byId(moved, "b").y).toBeLessThan(byId(moved, "a").y);
  });

  it("returns the layout unchanged for an unknown card", () => {
    const items = [item("a", 0, 0, 6, 4)];
    expect(moveBy(items, "zzz", "down")).toEqual(items);
  });
});

describe("resizeTo", () => {
  it("moves a card left so it stays inside the grid", () => {
    const items = [item("a", 8, 0, 4, 4)];
    const resized = byId(resizeTo(items, "a", "wide"), "a");
    expect(resized.w).toBe(8);
    expect(resized.x + resized.w).toBeLessThanOrEqual(COLUMNS);
  });

  it("leaves no overlap when a card grows into its neighbour", () => {
    const items = [item("a", 0, 0, 6, 4), item("b", 6, 0, 6, 4)];
    expect(noOverlap(resizeTo(items, "a", "full"))).toBe(true);
  });
});

describe("fitHeight", () => {
  it("sets the card's rows and keeps the layout free of overlap", () => {
    const items = [item("a", 0, 0, 12, 4), item("b", 0, 4, 12, 4)];
    const fitted = fitHeight(items, "a", 9);
    expect(byId(fitted, "a").h).toBe(9);
    expect(noOverlap(fitted)).toBe(true);
  });

  it("never goes below one row", () => {
    expect(byId(fitHeight([item("a", 0, 0, 4, 4)], "a", 0), "a").h).toBe(1);
  });
});

describe("settle", () => {
  it("closes a gap above a card", () => {
    expect(byId(settle([item("a", 0, 7, 6, 4)]), "a").y).toBe(0);
  });

  it("leaves no two cards overlapping", () => {
    const messy = [item("a", 0, 0, 8, 4), item("b", 4, 2, 8, 4), item("c", 0, 3, 12, 2)];
    expect(noOverlap(settle(messy))).toBe(true);
  });
});

describe("readingOrder", () => {
  it("sorts by row, then column, without changing the input", () => {
    const items = [item("c", 0, 4, 4, 2), item("b", 6, 0, 4, 2), item("a", 0, 0, 4, 2)];
    expect(readingOrder(items).map((i) => i.cardId)).toEqual(["a", "b", "c"]);
    expect(items.map((i) => i.cardId)).toEqual(["c", "b", "a"]);
  });
});

describe("rowsFor", () => {
  it("is the fewest rows whose height holds the content, counting the gap between rows", () => {
    const gap = 18;
    const height = (rows: number) => rows * ROW_HEIGHT + (rows - 1) * gap;
    expect(rowsFor(height(5), gap)).toBe(5);
    expect(rowsFor(height(5) + 1, gap)).toBe(6);
    expect(rowsFor(0, gap)).toBe(1);
  });
});
