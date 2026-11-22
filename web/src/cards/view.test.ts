import { describe, expect, it } from "vitest";
import { PAYLOADS } from "../test/cardApi";
import { initialView, settled } from "./view";

describe("settled", () => {
  it("returns the same view when the payload still supports it", () => {
    const p = PAYLOADS.distributionStandalone();
    const view = initialView(p);
    expect(settled(view, p)).toBe(view);
  });

  it("drops a sort and hidden columns the new payload no longer has", () => {
    const p = PAYLOADS.distributionStandalone();
    const keep = p.columns[0].key;
    const view = {
      ...initialView(p),
      sort: { column: "gone", part: "value" as const, dir: "desc" as const },
      hidden: [keep, "gone"],
    };
    const fixed = settled(view, p);
    expect(fixed.sort).toBeNull();
    expect(fixed.hidden).toEqual([keep]);
  });

  it("keeps a sort on a column that still exists", () => {
    const p = PAYLOADS.distributionStandalone();
    const sort = { column: p.columns[0].key, part: "value" as const, dir: "asc" as const };
    expect(settled({ ...initialView(p), sort }, p).sort).toEqual(sort);
  });

  it("falls back to the default lens and drops a sort that a cut change invalidates", () => {
    const p = PAYLOADS.distributionStandalone();
    const view = {
      ...initialView(p), lens: "no_such_lens", cut: "no_such_cut",
      sort: { column: p.columns[0].key, part: "value" as const, dir: "asc" as const },
    };
    const fixed = settled(view, p);
    expect(fixed.lens).toBe(p.meta.default_lens);
    expect(fixed.cut).toBe(p.cuts[0].id);
    expect(fixed.sort).toBeNull();
  });

  it("drops diverging when the lens is not a percentage-point lens (non-compare)", () => {
    const p = PAYLOADS.distributionStandalone();
    const pp = p.meta.lenses.find((l) => l.unit === "percentage_points");
    const other = p.meta.lenses.find((l) => l.unit !== "percentage_points");
    expect(other).toBeDefined();
    const view = { ...initialView(p), format: "diverging" as const, lens: other!.id };
    expect(settled(view, p).format).toBe("none");
    if (pp) expect(settled({ ...view, lens: pp.id }, p).format).toBe("diverging");
  });
});

describe("cascaded density", () => {
  const nestedPayload = () => {
    const p = PAYLOADS.distributionStandalone();
    const base = p.cuts[0];
    p.cuts = [{ ...base, id: "g0", dimensions: ["age_group"] }, { ...base, id: "g1", dimensions: ["age_group", "gender"] }];
    return p;
  };

  it("starts Cascaded only when the first table is split by two fields and its parent table exists", () => {
    const p = nestedPayload(); // [age_group], [age_group, gender]
    expect(initialView(p).density).toBe("standard"); // the first table is age_group alone
    p.cuts.reverse();
    expect(initialView(p).density).toBe("cascaded");
    expect(initialView(PAYLOADS.distributionStandalone()).density).toBe("standard");
  });

  it("starts Standard when a seat field is only a table of its own, Cascaded when it is a View by", () => {
    const p = nestedPayload(); // [age_group], [age_group, gender]: with age_group as the View by only one table remains
    expect(initialView(p, new Set(["age_group"])).density).toBe("standard");
    const [age, ageGender] = p.cuts;
    p.cuts = [{ ...ageGender, id: "g2", dimensions: ["party_zone", "age_group", "gender"] }, { ...age, id: "g0", dimensions: ["party_zone"] },
      { ...age, id: "g1", dimensions: ["party_zone", "age_group"] }];
    expect(initialView(p, new Set(["party_zone"])).density).toBe("cascaded");
  });

  it("falls back to Standard when the cuts stop nesting", () => {
    const p = nestedPayload();
    const view = { ...initialView(p), density: "cascaded" as const, cut: "g1" };
    expect(settled(view, p).density).toBe("cascaded");
    p.cuts[1].dimensions = ["gender"];
    expect(settled(view, p).density).toBe("standard");
    expect(settled({ ...view, cut: "g0" }, nestedPayload()).density).toBe("standard"); // age_group alone
  });

  it("drops a sort and a transpose while Cascaded, since both would flatten the tree", () => {
    const p = nestedPayload();
    const sort = { column: p.columns[0].key, part: "value" as const, dir: "asc" as const };
    const fixed = settled({ ...initialView(p), density: "cascaded", cut: "g1", sort, transposed: true }, p);
    expect(fixed.sort).toBeNull();
    expect(fixed.transposed).toBe(false);
  });

  it("keeps the table the analyst chose when Cascaded is on", () => {
    const p = nestedPayload();
    expect(settled({ ...initialView(p), density: "cascaded", cut: "g1" }, p).cut).toBe("g1");
  });
});
