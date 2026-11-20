import { describe, expect, it } from "vitest";
import { sizeClass } from "./sizeClass";

describe("sizeClass", () => {
  it("is narrow below 420px", () => {
    expect(sizeClass(0)).toBe("narrow");
    expect(sizeClass(419)).toBe("narrow");
  });

  it("is medium from 420px to 719px", () => {
    expect(sizeClass(420)).toBe("medium");
    expect(sizeClass(719)).toBe("medium");
  });

  it("is wide from 720px", () => {
    expect(sizeClass(720)).toBe("wide");
    expect(sizeClass(1200)).toBe("wide");
  });
});
