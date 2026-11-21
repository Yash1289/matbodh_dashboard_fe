import { describe, expect, it } from "vitest";
import type { StateContext } from "../api/types";
import { cardContext } from "./draft";

const CTX: StateContext = { state: "UP", rounds: ["R1", "R2", "R3"], compare_round: "R1", anchor_round: "R3", version_mode: "extrapolated", geo_scope: "state" };
const card = (over: object) => ({ id: "c", family: "distribution" as const, title: "T", ...over });

describe("cardContext", () => {
  it("is the context when the card chooses nothing", () => {
    expect(cardContext(card({}), CTX)).toEqual(CTX);
  });
  it("uses the card's own anchor and comparison survey", () => {
    expect(cardContext(card({ anchor_round: "R2", compare_round: "R3" }), CTX)).toMatchObject({ anchor_round: "R2", compare_round: "R3" });
  });
  it("one chosen survey is the anchor, several become the rounds read", () => {
    expect(cardContext(card({ surveys: ["R1"] }), CTX).anchor_round).toBe("R1");
    expect(cardContext(card({ surveys: ["R1", "R2"] }), CTX)).toMatchObject({ rounds: ["R1", "R2"], anchor_round: "R2" });
  });
  it("ignores a survey that is not in the context", () => {
    expect(cardContext(card({ anchor_round: "Nope" }), CTX)).toEqual(CTX);
  });
});
