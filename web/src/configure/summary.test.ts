import { describe, expect, it } from "vitest";
import type { CardConfigJson, StateContext } from "../api/types";
import { describeDraft } from "./summary";

const CTX: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["R1", "R2"], compare_round: "R1", anchor_round: "R2",
  version_mode: "extrapolated", geo_scope: "state",
};
const card = (over: Partial<CardConfigJson>): CardConfigJson => ({ id: "d", family: "distribution", title: "T", ...over });

describe("describeDraft", () => {
  it("says nothing until a subject is chosen", () => {
    expect(describeDraft(card({}), CTX)).toBeNull();
    expect(describeDraft(card({ family: "seat_ranking" }), CTX)).toBeNull();
    expect(describeDraft(card({ family: "relationship", relationship: { origin: "a" } }), CTX)).toBeNull();
  });

  it("a standalone grid card names its questions, the anchor round and the overall cut", () => {
    expect(describeDraft(card({ scenarios: ["vs_voting_intention", "pm_satisfaction"], cuts: [[]] }), CTX))
      .toBe("Shows vs_voting_intention, pm_satisfaction in R2, overall.");
  });

  it("crossed fields share a cut, separate cuts are listed apart", () => {
    expect(describeDraft(card({ scenarios: ["q"], cuts: [["age_group", "caste"], ["gender"], []] }), CTX))
      .toBe("Shows q in R2, split by age_group × caste; gender.");
  });

  it("compare names both rounds; trend names the window", () => {
    expect(describeDraft(card({ scenarios: ["q"], comparison: { mode: "compare" } }), CTX)).toContain("in R2 against R1");
    expect(describeDraft(card({ scenarios: ["q"], comparison: { mode: "trend" }, pipe_rounds: 2 }), CTX))
      .toContain("in the last 2 rounds up to R2");
    expect(describeDraft(card({ scenarios: ["q"], comparison: { mode: "trend" } }), CTX)).toContain("in every selected round");
  });

  it("filters with values are stated, empty ones are not", () => {
    const filters = [
      { field: "caste", operator: "in" as const, values: ["Yadav", "Jatav"] },
      { field: "gender", operator: "not_in" as const, values: ["Other"] },
      { field: "age_group", operator: "in" as const, values: [] },
    ];
    expect(describeDraft(card({ scenarios: ["q"], cuts: [[]], filters }), CTX))
      .toBe("Shows q in R2, overall, only where caste is Yadav, Jatav and gender is not Other.");
  });

  it("ranking, relationship and benchmark cards each read their own fields", () => {
    expect(describeDraft(card({ family: "seat_ranking", rank: { metric: "vote_share", party_id: "SP+" } }), CTX))
      .toBe("Ranks by vote_share for SP+ in R2.");
    expect(describeDraft(card({ family: "relationship", relationship: { origin: "vs_past", destination: "vs_voting_intention" }, cuts: [["caste"]] }), CTX))
      .toBe("Shows how vs_past answers move to vs_voting_intention in R2, split by caste.");
    expect(describeDraft(card({ family: "seat_benchmark", scenarios: ["q"], benchmark: { grouping_sets: [["zone"]] } }), CTX))
      .toBe("Benchmarks q in R2, split by zone.");
  });
});
