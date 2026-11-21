import { afterEach, describe, expect, it, vi } from "vitest";
import type { StateContext } from "../api/types";
import { readLastContext, saveLastContext } from "./lastContext";

const CTX: StateContext = {
  state: "Uttar Pradesh", rounds: ["2027 VS CAPI R1", "2027 VS CAPI R2"], compare_round: "2027 VS CAPI R1",
  anchor_round: null, version_mode: "matched", geo_scope: "state",
};

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("lastContext", () => {
  it("remembers the context the analyst last continued with", () => {
    saveLastContext(CTX);
    expect(readLastContext()).toEqual(CTX);
  });

  it("is null when nothing was saved or the stored text is unusable", () => {
    expect(readLastContext()).toBeNull();
    localStorage.setItem("mb.lastContext", "state=&level=zz");
    expect(readLastContext()).toBeNull();
  });

  it("never breaks the page when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => saveLastContext(CTX)).not.toThrow();
    expect(readLastContext()).toBeNull();
  });
});
