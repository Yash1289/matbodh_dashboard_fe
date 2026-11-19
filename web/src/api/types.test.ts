import { describe, expect, it } from "vitest";
import planByZone from "../test/fixtures/plan_by_zone_state_level.json";
import planScoreboard from "../test/fixtures/plan_scoreboard.json";
import runRunning from "../test/fixtures/run_running.json";
import surveys from "../test/fixtures/surveys.json";
import { PAYLOADS, doneRun } from "../test/cardApi";
import rankedTrend from "../test/fixtures/cards/ranked_seat_trend.json";
import { infoFor } from "../test/cardApi";
import { isRankedPayload, toCardRef, type CardPayload, type PlanResponse, type RunStatus, type SurveysResponse } from "./types";

// JSON imports widen string-literal unions to `string`, so cast through
// helpers; the shape is still asserted at runtime below.
const asRun = (v: unknown) => v as RunStatus;
const asPlan = (v: unknown) => v as PlanResponse;
const asSurveys = (v: unknown) => v as SurveysResponse;

describe("fixtures match the API types", () => {
  it("plans", () => {
    for (const f of [planScoreboard, planByZone]) {
      const p = asPlan(f);
      expect(p.valid).toBe(true);
      expect(Array.isArray(p.rounds)).toBe(true);
      expect(p.rounds.every((r) => typeof r.obs_id === "string")).toBe(true);
    }
  });

  it("card payloads carry the family, mode, lenses and cuts the shell reads", () => {
    for (const make of Object.values(PAYLOADS)) {
      const p = make();
      expect(["distribution", "opinion", "gender_differential"]).toContain(p.family);
      expect(["standalone", "compare", "trend"]).toContain(p.mode);
      expect(p.meta.lenses.map((l) => l.id)).toContain(p.meta.default_lens);
      expect(p.cuts.length).toBeGreaterThan(0);
      expect(asRun(doneRun(p)).result?.rounds.items.length).toBeGreaterThan(0);
    }
    expect(asRun(runRunning).result).toBeNull();
  });

  it("ranked payloads are told from grid payloads", () => {
    const ranked = rankedTrend as unknown as CardPayload;
    expect(isRankedPayload(ranked)).toBe(true);
    if (isRankedPayload(ranked)) {
      expect(ranked.mode).toBe("trend");
      expect(ranked.entities.length).toBeGreaterThan(0);
      expect(ranked.absent.map((a) => a.reason)).toEqual(["not_ranked"]);
    }
    expect(isRankedPayload(PAYLOADS.distributionStandalone())).toBe(false);
  });

  it("surveys", () => {
    expect(asSurveys(surveys).levels.ac?.[0].rounds.length).toBeGreaterThan(0);
  });
});

// Compile-time check (npm run typecheck).
void (surveys satisfies SurveysResponse);

describe("toCardRef", () => {
  const info = infoFor(PAYLOADS.distributionStandalone());

  it("a library card is referenced by id", () => {
    expect(toCardRef(info)).toEqual({ card_id: info.id });
  });

  it("an inline card sends its config without meta and inline", () => {
    const ref = toCardRef({ ...info, inline: true });
    expect("card" in ref).toBe(true);
    const card = (ref as unknown as { card: Record<string, unknown> }).card;
    expect("meta" in card || "inline" in card).toBe(false);
    expect(card).toMatchObject({ id: info.id, family: info.family, title: info.title });
  });
});

