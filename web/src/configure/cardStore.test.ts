import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardConfigJson, CardInfo } from "../api/types";
import { _dropMemory, cardStore, configOfInfo, copyConfigText } from "./cardStore";

const STATE = "Uttar Pradesh";
const CONFIG: CardConfigJson = {
  id: "ignored", family: "distribution", title: "Vote", scenarios: ["vs_voting_intention"], cuts: [[], ["caste"]],
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  _dropMemory();
});

describe("cardStore", () => {
  it("add assigns an id, stores the config under it, and survives a reload", () => {
    const stored = cardStore.add(STATE, CONFIG);
    expect(stored.id).not.toBe("ignored");
    expect(stored.config).toEqual({ ...CONFIG, id: stored.id });
    _dropMemory(); // as a page reload does
    expect(cardStore.list(STATE)).toEqual([stored]);
    expect(cardStore.list("Bihar")).toEqual([]); // per state
  });

  it("falls back to memory when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const stored = cardStore.add(STATE, CONFIG);
    expect(cardStore.list(STATE)).toEqual([stored]);
    cardStore.remove(STATE, stored.id);
    expect(cardStore.list(STATE)).toEqual([]);
  });

  it("an unreadable stored value is no cards, not an error", () => {
    localStorage.setItem(`mb.cards.${STATE}`, "{not json");
    expect(cardStore.list(STATE)).toEqual([]);
  });

  it("copy gives a new id and the same config", () => {
    const original = cardStore.add(STATE, CONFIG);
    const copy = cardStore.copy(STATE, original.id)!;
    expect(copy.id).not.toBe(original.id);
    expect({ ...copy.config, id: "", title: "" }).toEqual({ ...original.config, id: "", title: "" });
    expect(copy.config.id).toBe(copy.id);
    expect(copy.config.title).toBe("Vote (copy)");
    expect(cardStore.list(STATE).map((c) => c.id)).toEqual([original.id, copy.id]);
    expect(cardStore.copy(STATE, "nope")).toBeNull();
  });

  it("replace keeps the id and the position; remove drops the card", () => {
    const a = cardStore.add(STATE, CONFIG);
    const b = cardStore.add(STATE, { ...CONFIG, title: "Other" });
    cardStore.replace(STATE, a.id, { ...CONFIG, title: "Renamed", id: "tries-to-change-the-id" });
    expect(cardStore.list(STATE).map((c) => [c.id, c.config.title, c.config.id])).toEqual([
      [a.id, "Renamed", a.id], [b.id, "Other", b.id]]);
    cardStore.remove(STATE, a.id);
    expect(cardStore.list(STATE).map((c) => c.id)).toEqual([b.id]);
  });
});

describe("library cards and copied config", () => {
  const info = {
    id: "lib.vote", family: "distribution", section: "cards", title: "Library vote", scenarios: ["vs_voting_intention"],
    cuts: [[]], filters: [], comparison: { mode: "standalone", target: null, reference: null, delta_measures: [] },
    caste_clubbing: false, requires: { min_level: "state" },
    meta: { family: "distribution", lenses: [], default_lens: "", capabilities: { modes: [], transpose: false, sort: false, details: false } },
  } as unknown as CardInfo;

  it("library pick stores a copy with a new id, without meta", () => {
    const stored = cardStore.add(STATE, configOfInfo(info));
    expect(stored.id).not.toBe("lib.vote");
    expect(stored.config.title).toBe("Library vote");
    expect("meta" in stored.config || "inline" in stored.config).toBe(false);
  });

  it("Copy config is one YAML list item, with the id", () => {
    const text = copyConfigText({ id: "mine.1", family: "distribution", title: "T: with, punctuation", scenarios: ["a"] });
    expect(text.startsWith("- {")).toBe(true);
    expect(text).not.toContain("\n");
    expect(JSON.parse(text.slice(2))).toEqual({ id: "mine.1", family: "distribution", title: "T: with, punctuation", scenarios: ["a"] });
  });
});

describe("two open tabs", () => {
  const OTHER = { id: "other-tab", config: { ...CONFIG, id: "other-tab" } };

  it("does not overwrite a card another tab added since this one loaded", () => {
    const a = cardStore.add(STATE, CONFIG);
    localStorage.setItem(`mb.cards.${STATE}`, JSON.stringify([a, OTHER])); // the other tab's write
    const b = cardStore.add(STATE, CONFIG);
    expect(cardStore.list(STATE).map((c) => c.id)).toEqual([a.id, "other-tab", b.id]);
  });

  it("picks up another tab's change through the storage event", () => {
    expect(cardStore.list(STATE)).toEqual([]);
    localStorage.setItem(`mb.cards.${STATE}`, JSON.stringify([OTHER]));
    window.dispatchEvent(new StorageEvent("storage", { key: `mb.cards.${STATE}` }));
    expect(cardStore.list(STATE).map((c) => c.id)).toEqual(["other-tab"]);
  });
});

