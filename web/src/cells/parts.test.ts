import { describe, expect, it } from "vitest";
import type { RoundsBlock } from "../api/types";
import { partsFor, seriesBreaks } from "./parts";

describe("parts", () => {
  it("partsFor maps presets and density", () => {
    const all = ["value", "delta", "trend"] as const;
    expect(partsFor("both_trend", "compact", [...all])).toEqual(["value", "delta"]);
    expect(partsFor("both_trend", "detailed", [...all])).toEqual([
      "value", "delta", "trend", "base", "secondary", "flags",
    ]);
    expect(partsFor("share", "standard", ["value"])).toEqual(["value"]);
  });

  it("seriesBreaks finds group changes", () => {
    const rounds = { groups: [{ obs_ids: ["o1", "o2"] }, { obs_ids: ["o3"] }] } as RoundsBlock;
    expect(seriesBreaks(rounds)).toEqual([2]);
  });
});
