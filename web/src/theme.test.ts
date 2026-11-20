import { describe, expect, it } from "vitest";
import { cssVariablesResolver, deltaTone, tokens } from "./theme";

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

describe("contrast of the design tokens", () => {
  const c = tokens.color;

  it("keeps secondary text readable on white and on the table header fill", () => {
    expect(contrast(c.muted, c.white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.muted, c.headerBg)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps gain and loss readable on their own tints", () => {
    expect(contrast(c.gain, c.gainTint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.loss, c.lossTint)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps primary button text and tinted chip text readable", () => {
    expect(contrast(c.white, c.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.ink, c.primarySoft)).toBeGreaterThanOrEqual(4.5);
  });

  it("uses the faint grey for icons only, so it is below text contrast", () => {
    expect(contrast(c.faint, c.white)).toBeLessThan(4.5);
  });

  it("publishes the focus ring and the three elevations as CSS variables", () => {
    const vars = cssVariablesResolver({} as never).variables;
    expect(vars["--mb-ring"]).toBe(tokens.focusRing);
    expect(vars["--mb-elev-card"]).toBe(tokens.elevation.card);
    expect(vars["--mb-elev-pop"]).toBe(tokens.elevation.popover);
    expect(vars["--mb-elev-panel"]).toBe(tokens.elevation.panel);
    expect(vars["--mb-soft-line"]).toBe(c.softLine);
  });
});

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
