import { describe, expect, it } from "vitest";
import demographic from "../../test/fixtures/cards/ranked_demographic_standalone.json";
import seatTrend from "../../test/fixtures/cards/ranked_seat_trend.json";
import type { RankedPayload } from "../../api/types";
import { rankedToCsv } from "./rankedCsv";
import { initialRankedView, rankedRows } from "./rankedRows";

const trend = seatTrend as unknown as RankedPayload;
const demo = demographic as unknown as RankedPayload;

const csv = (p: RankedPayload) => rankedToCsv(p, rankedRows(p, initialRankedView(p))).split("\r\n");

describe("rankedToCsv", () => {
  it("has a rank and a value column per round, labelled with the round's short label", () => {
    const header = csv(trend)[0].split(",");
    expect(header[0]).toBe("group");
    expect(header.slice(-4)).toEqual(["rank_R1", "value_R1", "rank_R2", "value_R2"]);
    expect(header).toContain("seat_id");
  });

  it("writes the engine's numbers at full precision and a reason, never a zero, for an absent slot", () => {
    const lines = csv(trend);
    const header = lines[0].split(",");
    const row = lines.find((l) => l.split(",").includes("128"))!.split(",");
    const cell = (name: string) => row[header.indexOf(name)];
    expect(cell("rank_R1")).toBe("not_ranked");
    expect(cell("value_R1")).toBe("");
    expect(cell("rank_R2")).toBe("1");
    expect(cell("value_R2")).toBe("54.987736154245084");
  });

  it("names the partition in the group column and quotes fields with commas", () => {
    const lines = csv(demo);
    const header = lines[0].split(",");
    expect(header).toEqual(["group", "caste", "rank_R2", "value_R2"]);
    expect(lines[1].startsWith("1,")).toBe(true); // ac_num partition value
    expect(lines).toHaveLength(1 + demo.groups.reduce((n, g) => n + g.entities.length, 0));
  });
});
