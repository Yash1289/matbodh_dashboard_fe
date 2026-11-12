import { describe, expect, it } from "vitest";
import { RELATIONSHIP } from "../../test/cardApi";
import {
  cutsOf, initialRelationshipView, matrixRows, roundsWithData, summaryRows, valuesFor,
} from "./relationshipRows";

describe("relationship row helpers", () => {
  it("opens on the card's default table, the anchor round and the first group", () => {
    const p = RELATIONSHIP.transition();
    const v = initialRelationshipView(p);
    expect(v.table).toBe("summary");
    expect(v.round).toBe("R2");
    expect(v.cut).toBe(p.groups[0].set_id);
    expect(v.values).toEqual(p.groups[0].dimensions);
    expect(v.search).toBe("");
    expect(v.showDetails).toBe(false);
  });

  it("lists cuts, their dimensions and the values present (gender Other is not in the payload)", () => {
    const p = RELATIONSHIP.transition();
    const cuts = cutsOf(p);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].dimensions).toEqual(["gender"]);
    expect(new Set(valuesFor(p, cuts[0].key, "gender"))).toEqual(new Set(["Female", "Male"]));
    expect(roundsWithData(p)).toEqual(["R1", "R2"]);
  });

  it("builds nine matrix rows for a group, three of them diagonal, focal rows flagged", () => {
    const p = RELATIONSHIP.transition();
    const v = { ...initialRelationshipView(p), round: "R2", values: { gender: "Male" } };
    const rows = matrixRows(p, v)!;
    expect(rows).toHaveLength(9);
    expect(rows.filter((r) => r.stayed).map((r) => r.origin)).toEqual(p.parties);
    expect(rows.filter((r) => r.focal)).toHaveLength(5); // focal row (3) + focal column (3) share one cell
    expect(rows.every((r) => r.cell.round === "R2")).toBe(true);
    const bjpToSp = rows.find((r) => r.origin === "BJP+" && r.destination === "SP+")!;
    expect(bjpToSp.cell.joint_count).toBeGreaterThan(0);
  });

  it("returns null when the chosen group does not exist in the round", () => {
    const p = RELATIONSHIP.transition();
    const v = { ...initialRelationshipView(p), round: "R2", values: { gender: "Other" } };
    expect(matrixRows(p, v)).toBeNull();
    expect(matrixRows(p, { ...v, values: { gender: "Male", age_group: "18-25" } })).toBeNull();
  });

  it("shows all-absent cells as nine dash rows for a group whose cells are all absent", () => {
    const p = RELATIONSHIP.transition();
    p.cells = p.cells.map((c) =>
      c.round === "R2" && c.group.dimensions.gender === "Female"
        ? { ...c, absent: "no_respondents", joint_share: null, origin_share: null, destination_share: null, size_of_impact_pp: null }
        : c);
    const rows = matrixRows(p, { ...initialRelationshipView(p), round: "R2", values: { gender: "Female" } })!;
    expect(rows).toHaveLength(9);
    expect(rows.every((r) => r.cell.absent === "no_respondents")).toBe(true);
  });

  it("lists summary rows per group with both rounds and filters them by search", () => {
    const p = RELATIONSHIP.transition();
    const v = initialRelationshipView(p);
    const rows = summaryRows(p, v);
    expect(rows.map((r) => r.label).sort()).toEqual(["Female", "Male"]);
    expect(Object.keys(rows[0].byRound).sort()).toEqual(["R1", "R2"]);
    expect(summaryRows(p, { ...v, search: "fem" }).map((r) => r.label)).toEqual(["Female"]);
  });

  it("labels the overall group in words", () => {
    const p = RELATIONSHIP.transition();
    const overall = { set_id: "g9", dimensions: {} };
    p.groups.push(overall);
    p.summaries.push({ ...p.summaries[0], group: overall });
    expect(summaryRows(p, { ...initialRelationshipView(p), cut: "g9" }).map((r) => r.label)).toEqual(["All respondents"]);
  });

  it("never mutates the payload", () => {
    const p = RELATIONSHIP.transition();
    const copy = structuredClone(p);
    const v = initialRelationshipView(p);
    matrixRows(p, v); summaryRows(p, v); cutsOf(p); valuesFor(p, v.cut!, "gender"); roundsWithData(p);
    expect(p).toEqual(copy);
  });
});
