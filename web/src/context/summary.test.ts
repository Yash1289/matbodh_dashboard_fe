import { describe, expect, it } from "vitest";
import type { StateContext, SurveysResponse } from "../api/types";
import surveysJson from "../test/fixtures/surveys.json";
import { contextSummary } from "./summary";

const surveys = surveysJson as unknown as SurveysResponse;
const group = surveys.levels.ac?.[0].group ?? "";
const base: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["2027 VS CAPI R1", "2027 VS CAPI R2"],
  compare_round: "2027 VS CAPI R1", anchor_round: null, version_mode: "extrapolated", geo_scope: "state",
};

describe("contextSummary", () => {
  it("summary names compare round in full", () => {
    expect(contextSummary(base, surveys)).toBe(
      `Uttar Pradesh · AC level · ${group} R1–R2 · Δ vs 2027 VS CAPI R1 · Extrapolated · Geo: whole state`,
    );
  });

  it("a context over AC and zone rounds names both levels and still offers seat coverage", () => {
    const ctx: StateContext = { ...base, rounds: ["2027 VS CAPI R2", "2027 VS CAPI ST R1"], compare_round: null };
    const text = contextSummary(ctx, surveys);
    expect(text).toContain("AC + ZONE level");
    expect(text).toContain("Extrapolated");
    expect(text).not.toContain("Normal only");
  });

  it("summary for state level says Normal only", () => {
    const ctx: StateContext = { ...base, rounds: ["2027 VS CAPI ST R1"], compare_round: null };
    const zoneGroup = surveys.levels.zone?.[0].group ?? "";
    expect(contextSummary(ctx, surveys)).toBe(
      `Uttar Pradesh · ZONE level · ${zoneGroup} R1 · No Δ · Normal only · Geo: whole state`,
    );
  });
});
