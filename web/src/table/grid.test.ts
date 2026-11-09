import { describe, expect, it } from "vitest";
import scoreboardDone from "../test/fixtures/run_scoreboard_done.json";
import scoreboardPartial from "../test/fixtures/run_scoreboard_partial.json";
import withinOther from "../test/fixtures/run_scoreboard_within_other.json";
import leaders from "../test/fixtures/run_leaders_done.json";
import byZone from "../test/fixtures/run_by_zone_done.json";
import type { CardResult, RunStatus } from "../api/types";
import { gridFor, opinionGrid, scoreboardGrid, sortRows, transpose, zoneGrid } from "./grid";

const res = (f: unknown): CardResult => (f as RunStatus).result!;
const done = res(scoreboardDone);

describe("grid adapters", () => {
  it("scoreboard delta comes from the engine data", () => {
    const g = scoreboardGrid(done);
    expect(g.cells.NDA.vote.cell!.delta).toBe(-1.5);
    expect(g.columns.map((c) => c.key)).toEqual(["vote", "seats"]);
    expect(g.rows.map((r) => r.key)).toEqual(["NDA", "SP+", "BSP", "Other"]);
  });

  it("seat winner outside keep list is its own row marked within Other", () => {
    const g = scoreboardGrid(res(withinOther));
    expect(g.rows.find((r) => r.key === "JDL")!.note).toBe("within Other");
    expect(g.cells.JDL.seats.cell!.trend[0]).toBe(2);
    expect(g.cells.Other.seats.cell).toBeNull();
  });

  it("partial run keeps failed seat column", () => {
    const g = scoreboardGrid(res(scoreboardPartial));
    expect(g.columns.some((c) => c.key === "seats")).toBe(true);
    expect(g.cells.NDA.seats.cell!.value).toBe(154);
    expect(g.cells.NDA.seats.pcCell!.flags).toContain("failed");
  });

  it("unavailable seat parts appear as column notes", () => {
    const reason = "Seat views need an AC or PC level survey";
    const r: CardResult = {
      ...done,
      unavailable: [{ part: "seats_ac", reason }, { part: "seats_pc", reason }],
      scoreboard: done.scoreboard!.map((x) => ({ ...x, seats_ac: null, seats_pc: null })),
    };
    const g = scoreboardGrid(r);
    expect(g.columns.find((c) => c.key === "seats")!.note).toBe(reason);
    const other = scoreboardGrid({ ...r, unavailable: [{ part: "seats_ac", reason: "a" }, { part: "seats_pc", reason: "b" }] });
    expect(other.columns.find((c) => c.key === "seats")!.note).toBe("a; b");
  });

  it("scoreboard has one seats column", () => {
    const g = scoreboardGrid({ ...done, scoreboard: done.scoreboard!.map((x, i) => ({ ...x, gender_gap: i === 0 ? x.vote : null })) });
    expect(g.columns.map((c) => c.key)).toEqual(["vote", "seats", "gender_gap"]);
    expect(g.columns.map((c) => c.width)).toEqual([240, 240, 220]);
    expect(g.columns.map((c) => c.label)).toEqual(["Vote share", "Seats  AC · PC", "Gender gap"]);
    expect(g.columns[0].sub).toBe("% · Δ pp · trend R1 | R2");
    expect(g.columns[1].sub).toBe("AC · PC · Δ seats");
    expect(g.cells.NDA.seats).toEqual({ cell: done.scoreboard![0].seats_ac, pcCell: done.scoreboard![0].seats_pc, unit: "seats" });
  });

  it("opinion keeps not_returned and unavailable as rows", () => {
    const r = res(leaders);
    const g = opinionGrid({ ...r, unavailable: [{ part: "x_q", reason: "No data" }] });
    expect(g.rows.map((x) => x.key)).toEqual([
      "pm_satisfaction", "cm_satisfaction", "state_govt_satisfaction", "central_govt_satisfaction", "x_q",
    ]);
    expect(g.rows[2].note).toBe("No result returned");
    expect(g.cells.state_govt_satisfaction.net_score.cell).toBeNull();
    expect(g.rows[4].note).toBe("No data");
  });

  it("zone grid uses null-safe keys and first-seen series", () => {
    const g = zoneGrid(res(byZone));
    expect(g.columns.map((c) => c.key)).toEqual(["NDA", "SP+"]);
    expect(g.cells.Bundelkhand.NDA.cell!.value).toBe(45);
    expect(g.rowDim).toBe("party_zone");
  });

  it("gridFor dispatches on operation", () => {
    expect(gridFor(res(byZone)).columns[0].key).toBe("NDA");
    expect(gridFor(done).columns[0].key).toBe("vote");
  });
});

describe("transpose and sort", () => {
  it("transpose twice is identity", () => {
    const g = scoreboardGrid(done);
    expect(transpose(transpose(g))).toEqual(g);
    expect(transpose(g).cells.vote.NDA).toEqual(g.cells.NDA.vote);
  });

  it("sort by delta desc puts nulls last and null restores API order", () => {
    const g = scoreboardGrid(done);
    const api = g.rows.map((r) => r.key);
    const s = sortRows(g, { column: "vote", part: "delta", dir: "desc" }, api);
    expect(s.rows.map((r) => r.key)).toEqual(["SP+", "NDA", "BSP", "Other"]);
    const a = sortRows(g, { column: "vote", part: "delta", dir: "asc" }, api);
    expect(a.rows.map((r) => r.key)).toEqual(["NDA", "SP+", "BSP", "Other"]);
    expect(sortRows(s, null, api).rows.map((r) => r.key)).toEqual(api);
  });
});

describe("gridFor multi-measure lenses", () => {
  it("switches cell value and unit when a lens is selected", () => {
    const mockResult = {
      card_id: "caste_support", operation: "distribution", state: "Uttar Pradesh",
      rounds: { items: [], groups: [], anchor: "R2", compare: null },
      unavailable: [], not_asked: [], coverage: [], rules_version: 1, engine_version: "0.8.0",
      metadata_revision: 1, alliance_epoch: 1, hidden_count: 0,
      grid: {
        row_dim: "caste",
        rows: [
          {
            value: "Jatav", label: "Jatav",
            series: [{
              series: "NDA", label: "NDA", colour: "#ff9933",
              cell: { value: 42.0, delta: null, trend: [], secondary: null, flags: [], base: null },
              lenses: {
                contribution_share: { value: 18.0, delta: null, trend: [], secondary: null, flags: [], base: null },
                size_of_impact_pp: { value: 3.5, delta: null, trend: [], secondary: null, flags: [], base: null },
              }
            }]
          }
        ]
      }
    } as unknown as CardResult;

    const defaultGrid = gridFor(mockResult);
    expect(defaultGrid.cells["Jatav"]["NDA"].cell?.value).toBe(42.0);
    expect(defaultGrid.cells["Jatav"]["NDA"].unit).toBe("pct");

    const impactGrid = gridFor(mockResult, "size_of_impact_pp");
    expect(impactGrid.cells["Jatav"]["NDA"].cell?.value).toBe(3.5);
    expect(impactGrid.cells["Jatav"]["NDA"].unit).toBe("pp");
  });

  it("falls back to default cell if the requested lens is not available for a series item", () => {
    const mockResult = {
      card_id: "caste_support", operation: "distribution", state: "Uttar Pradesh",
      rounds: { items: [], groups: [], anchor: "R2", compare: null },
      unavailable: [], not_asked: [], coverage: [], rules_version: 1, engine_version: "0.8.0",
      metadata_revision: 1, alliance_epoch: 1, hidden_count: 0,
      grid: {
        row_dim: "caste",
        rows: [
          {
            value: "Jatav", label: "Jatav",
            series: [{
              series: "NDA", label: "NDA", colour: "#ff9933",
              cell: { value: 42.0, delta: null, trend: [], secondary: null, flags: [], base: null },
            }]
          }
        ]
      }
    } as unknown as CardResult;

    const impactGrid = gridFor(mockResult, "size_of_impact_pp");
    expect(impactGrid.cells["Jatav"]["NDA"].cell?.value).toBe(42.0);
  });
});
