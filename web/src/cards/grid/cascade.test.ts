import { describe, expect, it } from "vitest";
import type { Cut, GridPayload } from "../../api/types";
import { cascadable, cascadePayload, CASCADE_CUT, keepWithAncestors } from "./cascade";
import { payloadToGrid } from "./payloadToGrid";

type Spec = [key: string, labels: Record<string, string>, value: number, pop?: number];

const cut = (id: string, dimensions: string[], rows: Spec[]): Cut => ({
  id, dimensions,
  rows: rows.map(([key, labels]) => ({ key, labels, subtotal: [] })),
  cells: rows.map(([key, , value]) => ({ row: key, column: "p", round: "o1", lens: "support_share", value, status: "available" })),
  deltas: [], bases: [],
  population: rows.flatMap(([key, , , pop]) => (pop === undefined ? [] : [{ row: key, value: pop, status: "available" }])),
});

const payload = (cuts: Cut[], population = true): GridPayload => ({
  family: "distribution", card_id: "c", mode: "standalone", state: "UP",
  rounds: { items: [{ obs_id: "o1", base_name: "R1", label: "R1" }], groups: [], anchor: "o1", compare: null },
  meta: {
    family: "distribution", default_lens: "support_share",
    lenses: [{ id: "support_share", label: "Support", unit: "percentage", has_delta: false }],
    capabilities: { modes: ["standalone"], transpose: true, sort: true, details: true, population },
  },
  columns: [{ key: "p", label: "NDA", scenario: "s", kind: "party", colour: null, lenses: null }],
  cuts, unavailable: [], not_asked: [], coverage: [], provenance: {}, hidden_count: 0,
  rules_version: "v", engine_version: "e", metadata_revision: 1, alliance_epoch: 0,
} as unknown as GridPayload);

const AGE = cut("g0", ["age_group"], [
  ["age_group=18-23", { age_group: "18-23" }, 40, 14.2], ["age_group=24-35", { age_group: "24-35" }, 41, 30],
]);
const AGE_GENDER = cut("g1", ["age_group", "gender"], [
  ["age_group=18-23|gender=Male", { age_group: "18-23", gender: "Male" }, 42, 7.4],
  ["age_group=18-23|gender=Female", { age_group: "18-23", gender: "Female" }, 38, 6.8],
  ["age_group=24-35|gender=Male", { age_group: "24-35", gender: "Male" }, 43, 15],
]);

const keys = (p: GridPayload) => p.cuts[0].rows.map((r) => r.key);

describe("cascadable", () => {
  it("accepts a chain of cuts, each starting from the previous one", () => {
    expect(cascadable([AGE, AGE_GENDER]).ok).toBe(true);
    expect(cascadable([cut("o", [], []), AGE, AGE_GENDER]).ok).toBe(true); // the Overall cut is left out
  });

  it("trees the nested chain and leaves another table of its own out", () => {
    const other = cut("g2", ["occupation"], []);
    const found = cascadable([AGE, other, AGE_GENDER]);
    expect(found.ok && found.chain.map((c) => c.id)).toEqual(["g0", "g1"]);
  });

  it("refuses a finer cut without its parent cut, and unrelated cuts, with a reason", () => {
    const missing = cascadable([AGE_GENDER]);
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.reason).toMatch(/two or more fields/i);
    expect(cascadable([AGE, cut("g2", ["gender"], [])]).ok).toBe(false);
  });

  it("accepts a chain every table starts with a seat field for (a View by), when a tree remains once it is removed", () => {
    const tables = [cut("g0", ["zone"], []), cut("g1", ["zone", "age_group"], []), cut("g2", ["zone", "age_group", "gender"], [])];
    expect(cascadable(tables, new Set(["zone"])).ok).toBe(true);
    const short = cascadable([cut("g0", ["zone"], []), cut("g1", ["zone", "age_group"], [])], new Set(["zone"]));
    expect(short.ok).toBe(false); // only one table is left after the seat field goes
    expect(!short.ok && short.reason).toMatch(/two or more fields/i);
  });


});

describe("cascadePayload", () => {
  it("puts each parent row before its children, children in payload order", () => {
    const { payload: p, depth } = cascadePayload(payload([AGE, AGE_GENDER]))!;
    expect(keys(p)).toEqual([
      "age_group=18-23", "age_group=18-23|gender=Male", "age_group=18-23|gender=Female",
      "age_group=24-35", "age_group=24-35|gender=Male"]);
    expect(depth).toEqual({
      "age_group=18-23": 0, "age_group=18-23|gender=Male": 1, "age_group=18-23|gender=Female": 1,
      "age_group=24-35": 0, "age_group=24-35|gender=Male": 1 });
    expect(p.cuts).toHaveLength(1);
    expect(p.cuts[0].id).toBe(CASCADE_CUT);
  });

  it("is the selected table only: a table of one field cannot cascade, a table of two can, and Overall is not a row", () => {
    const overall = cut("g2", [], [["overall", {}, 55, 100]]);
    const all = [AGE, AGE_GENDER, overall];
    expect(cascadable(all, undefined, "g0").ok).toBe(false); // age_group alone
    expect(cascadable(all, undefined, "g2").ok).toBe(false); // Overall
    expect(cascadable(all, undefined, "g1").ok).toBe(true); // age_group x gender
    expect(keys(cascadePayload(payload(all), "g1")!.payload)).not.toContain("overall");
  });

  it("copies the parent's value from the coarser cut, never a sum of its children", () => {
    const { payload: p } = cascadePayload(payload([AGE, AGE_GENDER]))!;
    const value = (row: string) => p.cuts[0].cells.find((c) => c.row === row)!.value;
    expect(value("age_group=18-23")).toBe(40);
    expect(value("age_group=18-23|gender=Male")).toBe(42);
  });

  it("shows a category whose only caste has the same name as one row", () => {
    const cat = cut("g0", ["category"], [["category=GEN", { category: "GEN" }, 1], ["category=Yadav", { category: "Yadav" }, 2]]);
    const caste = cut("g1", ["category", "caste"], [
      ["category=GEN|caste=Thakur", { category: "GEN", caste: "Thakur" }, 3],
      ["category=Yadav|caste=Yadav", { category: "Yadav", caste: "Yadav" }, 2],
    ]);
    const { payload: p } = cascadePayload(payload([cat, caste]))!;
    expect(keys(p)).toEqual(["category=GEN", "category=GEN|caste=Thakur", "category=Yadav"]);
    expect(p.cuts[0].cells.map((c) => c.row)).not.toContain("category=Yadav|caste=Yadav");
  });

  it("keeps the grandchildren of a folded same-named child under its parent", () => {
    const cat = cut("g0", ["category"], [["category=GEN", { category: "GEN" }, 1], ["category=Yadav", { category: "Yadav" }, 2]]);
    const caste = cut("g1", ["category", "caste"], [
      ["category=GEN|caste=Thakur", { category: "GEN", caste: "Thakur" }, 3],
      ["category=Yadav|caste=Yadav", { category: "Yadav", caste: "Yadav" }, 2],
    ]);
    const kid = (c: string, s: string, g: string, v: number): Spec => [`category=${c}|caste=${s}|gender=${g}`, { category: c, caste: s, gender: g }, v];
    const gender = cut("g2", ["category", "caste", "gender"], [kid("GEN", "Thakur", "Male", 4), kid("Yadav", "Yadav", "Male", 5), kid("Yadav", "Yadav", "Female", 6)]);
    const { payload: p, depth } = cascadePayload(payload([cat, caste, gender]))!;
    expect(keys(p)).toEqual([
      "category=GEN", "category=GEN|caste=Thakur", "category=GEN|caste=Thakur|gender=Male",
      "category=Yadav", "category=Yadav|caste=Yadav|gender=Male", "category=Yadav|caste=Yadav|gender=Female"]);
    expect(keys(p).map((k) => depth[k])).toEqual([0, 1, 2, 0, 1, 1]);
    expect(p.cuts[0].cells.map((c) => c.row)).not.toContain("category=Yadav|caste=Yadav");
  });

  it("keeps a lone child whose name differs from its parent's", () => {
    const cat = cut("g0", ["category"], [["category=Muslim", { category: "Muslim" }, 1]]);
    const caste = cut("g1", ["category", "caste"], [["category=Muslim|caste=Sheikh", { category: "Muslim", caste: "Sheikh" }, 1]]);
    expect(keys(cascadePayload(payload([cat, caste]))!.payload)).toEqual(["category=Muslim", "category=Muslim|caste=Sheikh"]);
  });

  it("keeps a child whose parent row is missing, at the top level", () => {
    const lonely = cut("g1", ["age_group", "gender"], [["age_group=60+|gender=Male", { age_group: "60+", gender: "Male" }, 9]]);
    const { payload: p, depth } = cascadePayload(payload([AGE, lonely]))!;
    expect(keys(p)).toContain("age_group=60+|gender=Male");
    expect(depth["age_group=60+|gender=Male"]).toBe(0);
  });

  it("returns null when the cuts do not cascade", () => {
    expect(cascadePayload(payload([AGE_GENDER]))).toBeNull();
  });
});

describe("payloadToGrid for a cascaded payload and the Pop % column", () => {
  const cascaded = () => {
    const { payload: p, depth } = cascadePayload(payload([AGE, AGE_GENDER]))!;
    return payloadToGrid(p, { lens: "support_share", cut: CASCADE_CUT, cascade: depth });
  };

  it("labels a child by its last value and records its depth", () => {
    const g = cascaded();
    expect(g.rows.map((r) => [r.label, r.depth])).toEqual([
      ["18-23", 0], ["Male", 1], ["Female", 1], ["24-35", 0], ["Male", 1]]);
  });

  it("leads with a Pop % column taken from the payload, a dash where the anchor gave none", () => {
    const g = cascaded();
    expect(g.columns.map((c) => c.key)).toEqual(["__pop", "p"]);
    expect(g.columns[0].label).toBe("Pop %");
    expect(g.cells["age_group=18-23"].__pop.cell?.value).toBe(14.2);
    expect(g.cells["age_group=18-23|gender=Male"].__pop.cell?.value).toBe(7.4);
    const mixed = cut("g0", ["age_group"], [
      ["age_group=18-23", { age_group: "18-23" }, 40, 14.2], ["age_group=24-35", { age_group: "24-35" }, 41],
    ]);
    const plain = payloadToGrid(payload([mixed]), { lens: "support_share", cut: "g0" });
    expect(plain.cells["age_group=24-35"].__pop.cell).toBeNull();
  });

  it("has no Pop % column when no row of the table has one", () => {
    const none = cut("g0", ["age_group"], [["age_group=18-23", { age_group: "18-23" }, 40], ["age_group=24-35", { age_group: "24-35" }, 41]]);
    const g = payloadToGrid(payload([none]), { lens: "support_share", cut: "g0" });
    expect(g.columns.map((c) => c.key)).toEqual(["p"]);
    expect(g.cells["age_group=18-23"].__pop).toBeUndefined();
  });

  it("has no Pop % column for a family that returns no populations", () => {
    const g = payloadToGrid(payload([AGE], false), { lens: "support_share", cut: "g0" });
    expect(g.columns.map((c) => c.key)).toEqual(["p"]);
  });
});

describe("keepWithAncestors", () => {
  const rows = [["A", 0], ["Male", 1], ["Female", 1], ["B", 0], ["Male", 1]].map(([label, depth], i) => ({ key: `r${i}`, label: label as string, colour: null, depth: depth as number }));

  it("keeps a matching child with its parent, and a matching parent alone", () => {
    expect(keepWithAncestors(rows, (r) => r.label === "Female").map((r) => r.key)).toEqual(["r0", "r2"]);
    expect(keepWithAncestors(rows, (r) => r.label === "B").map((r) => r.key)).toEqual(["r3"]);
  });
});
