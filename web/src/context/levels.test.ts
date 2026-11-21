import { describe, expect, it } from "vitest";
import type { StateContext, SurveysResponse } from "../api/types";
import surveysJson from "../test/fixtures/surveys.json";
import { isOffered, levelOfRound, levelsOf } from "./levels";

const surveys = surveysJson as unknown as SurveysResponse;
const ctx = (rounds: string[]): StateContext => ({
  state: "Uttar Pradesh", rounds, compare_round: null, anchor_round: null, version_mode: "extrapolated", geo_scope: "state",
});

describe("levels", () => {
  it("finds a round's level in the catalogue", () => {
    expect(levelOfRound(surveys, "2027 VS CAPI R1")).toBe("ac");
    expect(levelOfRound(surveys, "2027 VS CAPI ST R1")).toBe("zone");
    expect(levelOfRound(surveys, "nope")).toBeNull();
  });

  it("lists the distinct levels in coarse-to-fine catalogue order", () => {
    expect(levelsOf(ctx(["2027 VS CAPI ST R1", "2027 VS CAPI R1", "2027 VS CAPI R2"]), surveys)).toEqual(["ac", "zone"]);
  });

  it("offers a remembered context only when every round still exists", () => {
    expect(isOffered(ctx(["2027 VS CAPI R1", "2027 VS CAPI ST R1"]), surveys)).toBe(true);
    expect(isOffered(ctx(["2027 VS CAPI R1", "gone"]), surveys)).toBe(false);
    expect(isOffered(ctx([]), surveys)).toBe(false);
  });
});
