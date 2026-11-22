import { describe, expect, it } from "vitest";
import { readCuts, writeCuts, type CutModel } from "./cutModel";

const isSeat = (f: string) => ["party_zone", "ac_num", "pc_num"].includes(f);
const nested = (...fields: string[]) => ({ fields, nested: true });
const flat = (...fields: string[]) => ({ fields, nested: false });

describe("writeCuts", () => {
  it("writes Overall, then each nested item as its parent tables down to the full cross", () => {
    const model: CutModel = { seat: null, overall: true, items: [nested("age_group", "gender")] };
    expect(writeCuts(model)).toEqual([[], ["age_group"], ["age_group", "gender"]]);
  });

  it("puts the seat attribute first in every table", () => {
    const model: CutModel = { seat: "party_zone", overall: true, items: [nested("age_group", "gender")] };
    expect(writeCuts(model)).toEqual([
      ["party_zone"], ["party_zone", "age_group"], ["party_zone", "age_group", "gender"]]);
  });

  it("writes a flat cross exactly as one table, and a seat field on its own as one table", () => {
    expect(writeCuts({ seat: null, overall: false, items: [flat("gender", "age_group"), flat("ac_num")] }))
      .toEqual([["gender", "age_group"], ["ac_num"]]);
  });

  it("never repeats a table", () => {
    const model: CutModel = { seat: null, overall: false, items: [nested("age_group", "gender"), flat("age_group")] };
    expect(writeCuts(model)).toEqual([["age_group"], ["age_group", "gender"]]);
  });
});

describe("readCuts", () => {
  it("reads parent tables plus their cross as one nested item", () => {
    expect(readCuts([[], ["age_group"], ["age_group", "gender"]], isSeat))
      .toEqual({ seat: null, overall: true, items: [nested("age_group", "gender")] });
  });

  it("reads a seat attribute that starts every table as the View by", () => {
    expect(readCuts([["party_zone"], ["party_zone", "age_group"], ["party_zone", "age_group", "gender"]], isSeat))
      .toEqual({ seat: "party_zone", overall: true, items: [nested("age_group", "gender")] });
  });

  it("keeps a cross whose parents are missing as the one table it is", () => {
    expect(readCuts([["gender", "age_group"]], isSeat)).toEqual({ seat: null, overall: false, items: [flat("gender", "age_group")] });
  });

  it("reads a single seat-first crossed table as a View by with one item", () => {
    expect(readCuts([["party_zone", "gender"]], isSeat)).toEqual({ seat: "party_zone", overall: false, items: [flat("gender")] });
  });

  it("does not invent a View by when only some tables start with the seat field", () => {
    const cuts = [["party_zone", "gender"], ["age_group"]];
    const model = readCuts(cuts, isSeat);
    expect(model.seat).toBeNull();
    expect(writeCuts(model)).toEqual(cuts);
  });

  it("reads a table saved twice as one item", () => {
    expect(readCuts([["gender"], ["gender"]], isSeat)).toEqual({ seat: null, overall: false, items: [flat("gender")] });
  });

  it("reads a seat field on its own as a table, not a View by", () => {
    const model = readCuts([[], ["party_zone"]], isSeat);
    expect(model).toEqual({ seat: null, overall: true, items: [flat("party_zone")] });
  });

  it.each([
    [[[], ["age_group"], ["age_group", "gender"], ["caste"]]],
    [[["party_zone"], ["party_zone", "age_group"], ["party_zone", "age_group", "gender"]]],
    [[["gender", "age_group"], ["age_group"]]],
    [[[]]],
  ])("writes back what it read: %j", (cuts) => {
    expect(writeCuts(readCuts(cuts, isSeat))).toEqual(cuts);
  });
});
