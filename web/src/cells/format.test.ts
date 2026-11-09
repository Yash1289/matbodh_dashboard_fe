import { describe, expect, it } from "vitest";
import type { Cell } from "../api/types";
import { flagInfo, formatDelta, formatPercent, formatTrendPipes, formatValue, nullReason } from "./format";

const cell = (flags: string[]): Cell => ({ value: null, delta: null, trend: [], secondary: null, flags, base: null });

describe("formatters", () => {
  it("formatValue renders null as em dash", () => {
    expect(formatValue(null, "pct")).toBe("—");
    expect(formatValue(null, "seats")).toBe("—");
  });

  it("percent rule boundary", () => {
    const cases: [number, string][] = [
      [1.996, "2.00%"], [2.0, "2%"], [-1.999, "−2.00%"], [1.99, "1.99%"], [0, "0.00%"],
      [0.004, "0.00%"], [-0.004, "0.00%"], [2.4, "2%"], [41.5, "42%"], [-2.68, "−3%"],
      [1.5, "1.50%"], [12.124964018941728, "12%"], [-41.5, "−42%"],
    ];
    for (const [v, out] of cases) expect(formatPercent(v)).toBe(out);
  });

  it("pp is signed with unicode minus", () => {
    expect(formatValue(-2.68, "pp")).toBe("−3%");
    expect(formatValue(4.6, "pp")).toBe("+5%");
    expect(formatValue(1.5, "pp")).toBe("+1.50%");
    expect(formatValue(0, "pp")).toBe("0.00%");
  });

  it("seats integer without percent", () => {
    expect(formatValue(154, "seats")).toBe("154");
  });

  it("delta arrows", () => {
    expect(formatDelta(-2.68, "pct")).toBe("▼3%");
    expect(formatDelta(-1.5, "pct")).toBe("▼1.50%");
    expect(formatDelta(91, "seats")).toBe("▲91");
    expect(formatDelta(-0.004, "pp")).toBe("0.00%");
    expect(formatDelta(0, "seats")).toBe("0");
    expect(formatDelta(null, "pct")).toBe("—");
  });

  it("trend pipes keep nulls", () => {
    expect(formatTrendPipes([null, 41.5], "pct")).toBe("— | 42%");
    expect(formatTrendPipes([33, 41.5], "pct")).toBe("33% | 42%");
  });

  it("unknown flag is kept", () => {
    expect(flagInfo("weird")).toEqual({ glyph: "?", reason: "weird" });
    expect(flagInfo("low_base")).toEqual({ glyph: "◌", reason: "Low base" });
    expect(flagInfo("no_delta").glyph).toBe("");
  });

  it("nullReason prefers failed", () => {
    expect(nullReason(cell(["not_asked", "failed"]))).toBe("Calculation failed for this round");
    expect(nullReason(cell(["not_asked"]))).toBe("Not asked in this round");
    expect(nullReason(cell(["low_base"]))).toBe("No value returned");
  });
});
