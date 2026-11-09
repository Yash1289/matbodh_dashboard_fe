import { describe, expect, it } from "vitest";
import scoreboardDone from "../test/fixtures/run_scoreboard_done.json";
import type { CardResult, RunStatus } from "../api/types";
import { toCsv } from "./csv";
import { scoreboardGrid } from "./grid";

const done = (scoreboardDone as unknown as RunStatus).result as CardResult;

describe("csv", () => {
  it("csv header flattens parts", () => {
    const first = toCsv(scoreboardGrid(done), done.rounds).split("\r\n")[0];
    expect(first.startsWith(
      "row,vote_2027_VS_CAPI_R1,vote_2027_VS_CAPI_R2,delta_vote_2027_VS_CAPI_R2_vs_2027_VS_CAPI_R1,base_vote,flags_vote",
    )).toBe(true);
  });

  it("csv writes null as empty, not 0", () => {
    const lines = toCsv(scoreboardGrid(done), done.rounds).split("\r\n");
    const other = lines.find((l) => l.startsWith("Other,"))!;
    expect(other.split(",")).toEqual(["Other", "8", "9", "", "", "no_delta", "", "", "", "", "", "", "", "", "", ""]);
  });

  it("csv keeps full precision and quotes RFC 4180", () => {
    const g = scoreboardGrid(done);
    g.cells.NDA.vote.cell = { ...g.cells.NDA.vote.cell!, trend: [42.0712345, 1], flags: ["a", "b"] };
    g.rows[0].label = 'NDA, "x"';
    const line = toCsv(g, done.rounds).split("\r\n")[1];
    expect(line.startsWith('"NDA, ""x""",42.0712345,1,-1.5,,a;b')).toBe(true);
  });
});
