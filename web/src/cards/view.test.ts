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
