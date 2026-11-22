import { describe, expect, it } from "vitest";
import type { Cut, GridPayload } from "../api/types";
import { PAYLOADS } from "../test/cardApi";
import { applySeat, resolveSeat, seatChoices, seatSplit, type FieldScope } from "./seatScope";

const scopes: Record<string, FieldScope> = {
  party_zone: "seat", incumbent_mla_party: "seat", ac_num: "seat", gender: "respondent", age_group: "respondent",
};

describe("seatSplit", () => {
  it("makes the first field the selector when it is a seat field with fields after it", () => {
    expect(seatSplit(["party_zone", "gender"], scopes)).toEqual({ field: "party_zone", rest: ["gender"] });
  });

  it("does nothing for a seat field on its own: it stays as plain rows", () => {
    expect(seatSplit(["ac_num"], scopes)).toBeNull();
  });

  it("does nothing when the seat field is not first", () => {
    expect(seatSplit(["age_group", "party_zone"], scopes)).toBeNull();
  });

  it("makes only the first of several seat fields the selector", () => {
    expect(seatSplit(["party_zone", "incumbent_mla_party", "gender"], scopes))
      .toEqual({ field: "party_zone", rest: ["incumbent_mla_party", "gender"] });
  });

  it("does nothing for an unknown field or an unscoped one", () => {
    expect(seatSplit(["mystery", "gender"], scopes)).toBeNull();
    expect(seatSplit(["gender", "age_group"], scopes)).toBeNull();
  });
});

const cut = (id: string, dimensions: string[], rows: [string, Record<string, string>][]): Cut => ({
  id, dimensions,
  rows: rows.map(([key, labels]) => ({ key, labels, subtotal: [] })),
  cells: rows.map(([key], i) => ({ row: key, column: "c", round: null, lens: "l", value: i + 1, status: "available" })),
  deltas: [], bases: [], population: [],
});

const crossed = cut("g1", ["party_zone", "gender"], [
  ["party_zone=A|gender=F", { party_zone: "A", gender: "F" }],
  ["party_zone=A|gender=M", { party_zone: "A", gender: "M" }],
  ["party_zone=B|gender=F", { party_zone: "B", gender: "F" }],
]);
const allZones = cut("g2", ["gender"], [["gender=F", { gender: "F" }], ["gender=M", { gender: "M" }]]);
const payloadOf = (...cuts: Cut[]) => ({ ...PAYLOADS.distributionStandalone(), cuts }) as GridPayload;

describe("seat choices", () => {
  it("lists the seat values in order and finds the All table when the engine has one", () => {
    const withAll = seatChoices(payloadOf(crossed, allZones), crossed, "party_zone");
    expect(withAll.values).toEqual(["A", "B"]);
    expect(withAll.all?.id).toBe("g2");
    expect(seatChoices(payloadOf(crossed), crossed, "party_zone").all).toBeNull();
  });

  it("defaults to All when it exists, else to the first value; a stale choice falls back to the default", () => {
    const p = payloadOf(crossed, allZones);
    const choices = seatChoices(p, crossed, "party_zone");
    expect(resolveSeat(choices, undefined)).toBeNull();
    expect(resolveSeat(choices, "B")).toBe("B");
    expect(resolveSeat(choices, "Z")).toBeNull();
    const noAll = seatChoices(payloadOf(crossed), crossed, "party_zone");
    expect(resolveSeat(noAll, undefined)).toBe("A");
    expect(resolveSeat(noAll, null)).toBe("A");
  });
});

describe("applySeat", () => {
  it("keeps only the chosen seat's rows and drops the seat field from labels and dimensions", () => {
    const p = payloadOf(crossed, allZones);
    const out = applySeat(p, "g1", "party_zone", "A");
    const shown = out.cuts.find((c) => c.id === "g1")!;
    expect(shown.dimensions).toEqual(["gender"]);
    expect(shown.rows.map((r) => r.key)).toEqual(["party_zone=A|gender=F", "party_zone=A|gender=M"]);
    expect(shown.rows.every((r) => !("party_zone" in r.labels))).toBe(true);
    expect(shown.cells.map((c) => c.row)).toEqual(["party_zone=A|gender=F", "party_zone=A|gender=M"]);
  });

  it("shows the engine's All table under the same cut id when All is chosen", () => {
    const out = applySeat(payloadOf(crossed, allZones), "g1", "party_zone", null);
    const shown = out.cuts.find((c) => c.id === "g1")!;
    expect(shown.rows.map((r) => r.key)).toEqual(["gender=F", "gender=M"]);
  });

  it("leaves the payload untouched and returns it as is for a different cut", () => {
    const p = payloadOf(crossed, allZones);
    const before = JSON.stringify(p);
    applySeat(p, "g1", "party_zone", "A");
    expect(JSON.stringify(p)).toBe(before);
    expect(applySeat(p, "g2", "party_zone", "A").cuts.find((c) => c.id === "g2")).toBe(allZones);
  });
});
