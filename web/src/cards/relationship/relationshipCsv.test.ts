import { describe, expect, it } from "vitest";
import { RELATIONSHIP } from "../../test/cardApi";
import { relationshipToCsv } from "./relationshipCsv";
import { initialRelationshipView } from "./relationshipRows";

const lines = (csv: string) => csv.split("\n");

describe("relationshipToCsv", () => {
  it("summary: one row per group and round with the engine values unformatted", () => {
    const p = RELATIONSHIP.transition();
    const out = lines(relationshipToCsv(p, initialRelationshipView(p)));
    expect(out[0]).toBe("Group,Round,Net flow,Retention share,Gained population share,Lost population share,Acquisition share");
    expect(out).toHaveLength(1 + 2 * 2); // two genders, two rounds
    const r2 = p.summaries.find((s) => s.round === "R2" && s.group.dimensions.gender === "Male")!;
    expect(out).toContain(["Male", "R2", r2.net_flow_pp, r2.retention_share, r2.gained_population_share,
      r2.lost_population_share, r2.acquisition_share].join(","));
  });

  it("matrix: the nine pairs of the selected round and group, an absent cell empty with its reason", () => {
    const p = RELATIONSHIP.transition();
    p.cells = p.cells.map((c) => c.round === "R2" && c.group.dimensions.gender === "Male" && c.origin === "BJP+" && c.destination === "SP+"
      ? { ...c, absent: "no_respondents", origin_share: null, destination_share: null, joint_share: null, size_of_impact_pp: null }
      : c);
    const view = { ...initialRelationshipView(p), table: "matrix" as const, round: "R2", values: { gender: "Male" } };
    const out = lines(relationshipToCsv(p, view));
    expect(out[0]).toBe("Group,Round,Origin,Destination,Stayed,Origin share,Destination share,Joint share,Size of impact,Absent");
    expect(out).toHaveLength(10);
    expect(out).toContain("Male,R2,BJP+,SP+,no,,,,,no respondents moved");
    const kept = p.cells.find((c) => c.round === "R2" && c.group.dimensions.gender === "Male" && c.origin === "SP+" && c.destination === "SP+")!;
    expect(out).toContain(["Male", "R2", "SP+", "SP+", "yes", kept.origin_share, kept.destination_share, kept.joint_share,
      kept.size_of_impact_pp, ""].join(","));
  });

  it("with Details on, both tables export the extra columns the screen shows", () => {
    const p = RELATIONSHIP.transition();
    const base = initialRelationshipView(p);
    const summary = lines(relationshipToCsv(p, { ...base, showDetails: true }));
    expect(summary[0]).toContain("Paired base");
    expect(summary[0]).toContain("Respondents");
    const male = p.summaries.find((s) => s.round === "R2" && s.group.dimensions.gender === "Male")!;
    expect(summary).toContainEqual(expect.stringContaining(`${male.paired_base},${male.paired_count}`));
    const matrix = lines(relationshipToCsv(p, { ...base, table: "matrix", round: "R2", values: { gender: "Male" }, showDetails: true }));
    expect(matrix[0].endsWith("Absent,Respondents,Origin base,Destination base,Paired base,Paired respondents")).toBe(true);
  });
});
