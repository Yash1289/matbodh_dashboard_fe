import { describe, expect, it } from "vitest";
import planByZone from "../test/fixtures/plan_by_zone_state_level.json";
import planScoreboard from "../test/fixtures/plan_scoreboard.json";
import runByZone from "../test/fixtures/run_by_zone_done.json";
import runChange from "../test/fixtures/run_change_appetite_done.json";
import runLeaders from "../test/fixtures/run_leaders_done.json";
import runRunning from "../test/fixtures/run_running.json";
import runScoreboard from "../test/fixtures/run_scoreboard_done.json";
import runPartial from "../test/fixtures/run_scoreboard_partial.json";
import runWithinOther from "../test/fixtures/run_scoreboard_within_other.json";
import surveys from "../test/fixtures/surveys.json";
import templates from "../test/fixtures/templates_pulse.json";
import type { PlanResponse, RunStatus, SurveysResponse, Template } from "./types";

// JSON imports widen string-literal unions to `string`, so cast through
// helpers; the shape is still asserted at runtime below.
const asRun = (v: unknown) => v as RunStatus;
const asPlan = (v: unknown) => v as PlanResponse;
const asSurveys = (v: unknown) => v as SurveysResponse;
const asTemplates = (v: unknown) => v as Template[];

describe("fixtures match the API types", () => {
  it("plans", () => {
    for (const f of [planScoreboard, planByZone]) {
      const p = asPlan(f);
      expect(p.valid).toBe(true);
      expect(Array.isArray(p.rounds)).toBe(true);
      expect(p.rounds.every((r) => typeof r.obs_id === "string")).toBe(true);
    }
  });

  it("runs", () => {
    for (const f of [runByZone, runChange, runLeaders, runScoreboard, runPartial, runWithinOther]) {
      const r = asRun(f);
      expect(["done", "partial"]).toContain(r.state);
      expect(r.result?.rounds.items.length).toBeGreaterThan(0);
    }
    expect(asRun(runRunning).result).toBeNull();
    expect(asRun(runPartial).errors.seats_pc.kind).toBe("config");
    expect(asRun(runScoreboard).result?.scoreboard?.[0].vote).toBeDefined();
    expect(asRun(runByZone).result?.grid?.rows.length).toBeGreaterThan(0);
  });

  it("surveys and templates", () => {
    expect(asSurveys(surveys).levels.ac?.[0].rounds.length).toBeGreaterThan(0);
    expect(asTemplates(templates).length).toBeGreaterThan(0);
  });
});

// Compile-time check (npm run typecheck). Other fixtures contain literal
// unions (state, operation, valid) that widen to string in JSON imports, so
// they are cast via the helpers above instead.
void (surveys satisfies SurveysResponse);
