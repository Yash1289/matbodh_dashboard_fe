import { describe, expect, it } from "vitest";
import { deltaTone } from "./theme";

describe("delta tone", () => {
  it("follows the sign; zero and null are neutral", () => {
    expect(deltaTone(1.4)).toBe("gain");
    expect(deltaTone(-0.6)).toBe("loss");
    expect(deltaTone(0)).toBe("neutral");
    expect(deltaTone(null)).toBe("neutral");
  });

  it("treats a delta that displays as zero as neutral", () => {
    expect(deltaTone(0.004)).toBe("neutral");
    expect(deltaTone(-0.004)).toBe("neutral");
    expect(deltaTone(0.4, "seats")).toBe("neutral");
    expect(deltaTone(0.6, "seats")).toBe("gain");
  });

  it("rounds at the display boundary", () => {
    expect(deltaTone(1.996)).toBe("gain");
    expect(deltaTone(2)).toBe("gain");
    expect(deltaTone(-1.996)).toBe("loss");
  });
});

// Raw source of every module; colours must live in theme.ts (and the two chart/format exceptions).
const sources = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const ALLOWED = ["/src/theme.ts", "/src/cells/Sparkline.tsx", "/src/table/formatRules.ts"];

describe("colour tokens", () => {
  it("no hex colours outside theme.ts", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    const offenders = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$/.test(path) && !ALLOWED.includes(path))
      .filter(([, text]) => /#[0-9a-fA-F]{3,8}\b/.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
