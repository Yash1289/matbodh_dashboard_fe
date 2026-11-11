import { describe, expect, it } from "vitest";
import { BENCHMARK } from "../../test/cardApi";
import { benchmarkToCsv } from "./benchmarkCsv";

describe("benchmarkToCsv", () => {
  it("exports the comparison table with the engine's values and Other last in its group", () => {
    const p = BENCHMARK.surveyVs2022();
    const lines = benchmarkToCsv(p, { table: "comparison", search: "" }).split("\n");
    expect(lines[0]).toMatch(/^Group,Party,/);
    const statewide = lines.filter((l) => l.startsWith("All seats,"));
    expect(statewide.map((l) => l.split(",")[1])).toEqual(["BSP", "NDA", "SP+", "Other"]);
    expect(statewide.find((l) => l.split(",")[1] === "NDA")).toMatch(/,154,273,-119$/);
  });

  it("writes a missing value as an empty cell, never 0", () => {
    const p = BENCHMARK.surveyVs2022();
    const i = p.summaries.findIndex((r) => r.endpoint === "target" && r.group.set_id === "g0" && r.party === "NDA");
    p.summaries[i] = { ...p.summaries[i], seats: null, seat_share: null, vote_share: null, absent: "not_in_endpoint_mapping" };
    const lines = benchmarkToCsv(p, { table: "summary", search: "" }).split("\n");
    expect(lines).toContain(`All seats,NDA,R2,,,,${p.summaries[i].eligible_seats}`);
  });
});
