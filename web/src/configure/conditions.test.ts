import { describe, expect, it } from "vitest";
import type { Condition, FamilyDescriptor, FieldDescriptor } from "../api/types";
import families from "../test/fixtures/configure_families.json";
import { compareGroup, evaluate, getPath, isSet, pruneHidden, setPath, visibleFields } from "./conditions";

const KINDS = { vs_voting_intention: "party", vs_past: "recalled", pm_satisfaction: "opinion" };
const test = (c: Condition, draft: object) => evaluate(c, draft, KINDS);

describe("getPath / setPath", () => {
  it("reads dotted and indexed paths, and missing ones as undefined", () => {
    const draft = { comparison: { mode: "trend" }, scenarios: ["a", "b"] };
    expect(getPath(draft, "comparison.mode")).toBe("trend");
    expect(getPath(draft, "scenarios.1")).toBe("b");
    expect(getPath(draft, "rank.metric")).toBeUndefined();
    expect(getPath(draft, "scenarios.5")).toBeUndefined();
  });

  it("setPath is immutable and creates the parents it needs", () => {
    const draft = { title: "T" };
    const next = setPath(draft, "comparison.target.scenario", "x");
    expect(next).toEqual({ title: "T", comparison: { target: { scenario: "x" } } });
    expect(draft).toEqual({ title: "T" });
  });
});

describe("evaluate", () => {
  it("equals", () => {
    const c: Condition = { op: "equals", path: "comparison.mode", value: "compare" };
    expect(test(c, { comparison: { mode: "compare" } })).toBe(true);
    expect(test(c, { comparison: { mode: "trend" } })).toBe(false);
    expect(test(c, {})).toBe(false);
  });

  it("in", () => {
    const c: Condition = { op: "in", path: "comparison.mode", values: ["standalone", "trend"] };
    expect(test(c, { comparison: { mode: "trend" } })).toBe(true);
    expect(test(c, { comparison: { mode: "compare" } })).toBe(false);
  });

  it("nonempty", () => {
    const c: Condition = { op: "nonempty", path: "filters" };
    expect(test(c, { filters: [{ field: "caste", operator: "in", values: ["a"] }] })).toBe(true);
    expect(test(c, { filters: [] })).toBe(false);
    expect(test(c, {})).toBe(false);
    expect(test({ op: "nonempty", path: "title" }, { title: "" })).toBe(false);
    expect(test({ op: "nonempty", path: "title" }, { title: "T" })).toBe(true);
  });

  it("contains, on a list and on a list of lists", () => {
    const c: Condition = { op: "contains", path: "cuts", value: "caste" };
    expect(test(c, { cuts: [[], ["age_group", "caste"]] })).toBe(true);
    expect(test(c, { cuts: [["age_group"]] })).toBe(false);
    expect(test({ op: "contains", path: "scenarios", value: "a" }, { scenarios: ["a"] })).toBe(true);
    expect(test(c, {})).toBe(false);
  });

  it("kind_of: a recalled scenario is also a party scenario", () => {
    const at = (kind: "party" | "opinion" | "recalled", scenario: string): boolean =>
      test({ op: "kind_of", path: "scenarios.0", kind }, { scenarios: [scenario] });
    expect(at("party", "vs_voting_intention")).toBe(true);
    expect(at("party", "vs_past")).toBe(true);
    expect(at("recalled", "vs_past")).toBe(true);
    expect(at("recalled", "vs_voting_intention")).toBe(false);
    expect(at("opinion", "pm_satisfaction")).toBe(true);
    expect(at("opinion", "vs_past")).toBe(false);
    expect(at("party", "unknown_scenario")).toBe(false);
    expect(test({ op: "kind_of", path: "scenarios.0", kind: "party" }, {})).toBe(false);
  });

  it("count_at_least", () => {
    const c: Condition = { op: "count_at_least", path: "scenarios", n: 2 };
    expect(test(c, { scenarios: ["a", "b"] })).toBe(true);
    expect(test(c, { scenarios: ["a"] })).toBe(false);
    expect(test(c, {})).toBe(false);
  });

  it("all, any, not", () => {
    const yes: Condition = { op: "equals", path: "a", value: 1 };
    const no: Condition = { op: "equals", path: "a", value: 2 };
    expect(test({ op: "all", of: [yes, yes] }, { a: 1 })).toBe(true);
    expect(test({ op: "all", of: [yes, no] }, { a: 1 })).toBe(false);
    expect(test({ op: "any", of: [no, yes] }, { a: 1 })).toBe(true);
    expect(test({ op: "any", of: [no, no] }, { a: 1 })).toBe(false);
    expect(test({ op: "not", of: no }, { a: 1 })).toBe(true);
    expect(test({ op: "all", of: [] }, {})).toBe(true);
    expect(test({ op: "any", of: [] }, {})).toBe(false);
  });
});

const field = (path: string, show_when?: Condition): FieldDescriptor => ({
  path, label: path, widget: "text", required: false, tier: "more", multiple: false, ...(show_when ? { show_when } : {}),
});
const COMPARE: Condition = { op: "equals", path: "comparison.mode", value: "compare" };
const FAMILY: FamilyDescriptor = {
  family: "distribution", label: "L", description: "D",
  meta: { family: "distribution", lenses: [], default_lens: "", capabilities: { modes: [], transpose: false, sort: false, details: false, population: false } },
  fields: [
    field("title"),
    field("scenarios", { op: "not", of: COMPARE }),
    field("comparison.mode"),
    field("comparison.target.scenario", COMPARE),
    field("comparison.reference.scenario", COMPARE),
    field("comparison.reference.round", COMPARE),
    field("cuts"),
    field("caste_clubbing", { op: "contains", path: "cuts", value: "caste" }),
    field("pipe_rounds", { op: "equals", path: "comparison.mode", value: "trend" }),
  ],
};

describe("visibleFields", () => {
  it("shows a field when it has no condition or its condition holds", () => {
    const paths = (draft: object) => visibleFields(FAMILY, draft, KINDS).map((f) => f.path);
    expect(paths({ cuts: [["caste"]] })).toEqual(["title", "scenarios", "comparison.mode", "cuts", "caste_clubbing"]);
    expect(paths({ comparison: { mode: "compare" } })).toEqual([
      "title", "comparison.mode", "comparison.target.scenario", "comparison.reference.scenario",
      "comparison.reference.round", "cuts"]);
  });
});

describe("pruneHidden", () => {
  it("prunes values of fields hidden by their condition (compare -> standalone drops the endpoints)", () => {
    const draft = {
      title: "T", comparison: { mode: "standalone", target: { scenario: "a" }, reference: { scenario: "b", round: "compare" } },
      scenarios: ["a"],
    };
    const pruned = pruneHidden(FAMILY, draft, KINDS);
    expect(pruned).toEqual({ title: "T", comparison: { mode: "standalone" }, scenarios: ["a"] });
    expect(draft.comparison.reference).toBeDefined(); // the input is not mutated
  });

  it("drops the scenarios when compare is chosen, since the compare endpoints carry them", () => {
    const pruned = pruneHidden(FAMILY, { title: "T", scenarios: ["a"], comparison: { mode: "compare" } }, KINDS);
    expect(pruned).toEqual({ title: "T", comparison: { mode: "compare" } });
  });

  it("prunes chained dependants (removing caste from cuts drops caste_clubbing)", () => {
    const pruned = pruneHidden(FAMILY, { title: "T", cuts: [["age_group"]], caste_clubbing: true }, KINDS);
    expect(pruned).toEqual({ title: "T", cuts: [["age_group"]] });
  });

  it("repeats until stable when one removal hides another field", () => {
    const chain: FamilyDescriptor = {
      ...FAMILY,
      fields: [
        field("a"),
        field("b", { op: "nonempty", path: "a" }),
        field("c", { op: "nonempty", path: "b" }),
      ],
    };
    expect(pruneHidden(chain, { b: "x", c: "y" }, KINDS)).toEqual({});
    expect(pruneHidden(chain, { a: "1", b: "x", c: "y" }, KINDS)).toEqual({ a: "1", b: "x", c: "y" });
  });

  it("leaves values of fields the descriptor does not know untouched", () => {
    expect(pruneHidden(FAMILY, { id: "mine", family: "distribution" }, KINDS)).toEqual({ id: "mine", family: "distribution" });
  });
});

describe("compareGroup", () => {
  const distribution = (families as unknown as FamilyDescriptor[]).find((d) => d.family === "distribution")!;
  const primary = (draft: object) => visibleFields(distribution, draft, KINDS).filter((f) => f.tier === "primary");

  it("is the primary fields that appear only when comparing two questions", () => {
    const group = compareGroup(primary({ comparison: { mode: "compare" } }));
    expect(group.map((f) => f.path)).toEqual(["comparison.target.scenario", "comparison.reference.scenario"]);
  });

  it("is empty when not comparing, and never takes a field that is hidden by comparing", () => {
    expect(compareGroup(primary({}))).toEqual([]);
    const shown = primary({ comparison: { mode: "compare" } }).map((f) => f.path);
    expect(shown).not.toContain("scenarios"); // Questions is hidden in compare mode
  });
});

describe("isSet", () => {
  it("counts a value the user chose, not an empty one", () => {
    expect(isSet("x")).toBe(true);
    expect(isSet(3)).toBe(true);
    expect(isSet(true)).toBe(true);
    expect(isSet(["a"])).toBe(true);
    for (const empty of [undefined, null, "", [], false]) expect(isSet(empty)).toBe(false);
  });
});
