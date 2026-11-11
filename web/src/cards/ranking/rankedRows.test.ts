import { describe, expect, it } from "vitest";
import demographic from "../../test/fixtures/cards/ranked_demographic_standalone.json";
import seatTrend from "../../test/fixtures/cards/ranked_seat_trend.json";
import type { RankedPayload } from "../../api/types";
import { initialRankedView, rankedRows, tieKeys, type RankedRowModel } from "./rankedRows";

const trend = seatTrend as unknown as RankedPayload;
const demo = demographic as unknown as RankedPayload;

describe("rankedRows", () => {
  it("keeps the payload's entity order by default", () => {
    const { groups, rounds } = rankedRows(trend, initialRankedView(trend));
    expect(rounds).toEqual(["o1", "o2"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.entity.key)).toEqual(trend.groups[0].entities);
  });

  it("lays slots out in round order and keeps absent reasons", () => {
    const row = rankedRows(trend, initialRankedView(trend)).groups[0].rows.find((r) => r.entity.key === "128")!;
    expect(row.slots[0]).toEqual({ kind: "absent", round: "o1", reason: "not_ranked" });
    expect(row.slots[1]).toMatchObject({ kind: "ranked", round: "o2", rank: 1, value: 54.987736154245084 });
  });

  it("never computes a number: every ranked slot equals the payload's value", () => {
    const rows = rankedRows(trend, initialRankedView(trend)).groups[0].rows;
    for (const row of rows) {
      for (const slot of row.slots) {
        if (slot.kind !== "ranked") continue;
        const source = trend.ranks.find((r) => r.entity === row.entity.key && r.round === slot.round)!;
        expect([slot.rank, slot.value]).toEqual([source.rank, source.value]);
      }
    }
  });

  it("sorts by a later round's rank without moving slots, absent rows last in both directions", () => {
    for (const dir of ["asc", "desc"] as const) {
      const rows = rankedRows(trend, { ...initialRankedView(trend), sort: { round: "o1", by: "rank", dir } }).groups[0].rows;
      expect(rows[rows.length - 1].entity.key).toBe("128");
      expect(rows[rows.length - 1].slots[0]).toMatchObject({ kind: "absent" });
    }
    const asc = rankedRows(trend, { ...initialRankedView(trend), sort: { round: "o1", by: "rank", dir: "asc" } }).groups[0].rows;
    const best = trend.ranks.filter((r) => r.round === "o1").reduce((a, b) => (b.rank! < a.rank! ? b : a));
    expect(asc[0].entity.key).toBe(best.entity);
  });

  it("sorts by value", () => {
    const rows = rankedRows(trend, { ...initialRankedView(trend), sort: { round: "o2", by: "value", dir: "asc" } }).groups[0].rows;
    const values = rows.map((r) => (r.slots[1] as { value: number }).value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("searches seat id and name", () => {
    const byName = rankedRows(trend, { ...initialRankedView(trend), search: "seat 128" }).groups[0].rows;
    expect(byName.map((r) => r.entity.key)).toEqual(["128"]);
    expect(rankedRows(trend, { ...initialRankedView(trend), search: "no such seat" }).groups).toEqual([]);
  });

  it("searches a demographic level value across partitions", () => {
    const { groups } = rankedRows(demo, { ...initialRankedView(demo), search: "nishad" });
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) expect(g.rows.every((r) => r.entity.labels.caste === "Nishad")).toBe(true);
  });
});

describe("tieKeys", () => {
  const row = (key: string, rank: number | null): RankedRowModel => ({
    key, entity: { key, labels: {} }, group: trend.groups[0],
    slots: [{ kind: "ranked", round: "o2", rank, value: 1, status: "available", flags: [] }],
  });

  it("marks rows that share a rank in the anchor round", () => {
    const rows = [row("a", 1), row("b", 1), row("c", 3), row("d", null)];
    expect([...tieKeys(rows, "o2")].sort()).toEqual(["a", "b"]);
  });
});
