import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardConfigJson } from "../api/types";
import { _dropMemory, cardStore, type StoredCard } from "../configure/cardStore";
import { _dropWorkspaceMemory, reconcile, workspaceStore, type Workspace } from "./workspaceStore";
import { COLUMNS } from "./layout";

const STATE = "Uttar Pradesh";
const CONFIG: CardConfigJson = {
  id: "ignored", family: "distribution", title: "Vote", scenarios: ["vs_voting_intention"], cuts: [[], ["caste"]],
};
const card = (id: string): StoredCard => ({ id, config: { ...CONFIG, id } });

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  _dropMemory();
  _dropWorkspaceMemory();
});

const read = (state = STATE): Workspace => workspaceStore.get(state);

describe("reconcile", () => {
  it.each([[null], ["text"], [[1, 2]], [{ version: 2, tabs: [] }], [{ version: 1, activeTab: "x", tabs: [] }], [{ version: 1, tabs: [{ id: 3 }] }]])(
    "gives a fresh one-tab workspace for unusable stored data (%j)", (raw) => {
      const ws = reconcile(raw, []);
      expect(ws.tabs).toHaveLength(1);
      expect(ws.tabs[0]).toMatchObject({ name: "Tab 1", items: [] });
      expect(ws.activeTab).toBe(ws.tabs[0].id);
    });

  it("drops items whose card is gone", () => {
    const raw = { version: 1, activeTab: "t", tabs: [{ id: "t", name: "A", items: [{ cardId: "c1", x: 0, y: 0, w: 4, h: 4 }, { cardId: "gone", x: 4, y: 0, w: 4, h: 4 }] }] };
    expect(reconcile(raw, [card("c1")]).tabs[0].items.map((i) => i.cardId)).toEqual(["c1"]);
  });

  it("puts a card no tab holds into the first tab at full width, in stored order, one per row", () => {
    const ws = reconcile(null, [card("c1"), card("c2")]);
    const [a, b] = ws.tabs[0].items;
    expect([a.cardId, a.x, a.w, a.y]).toEqual(["c1", 0, COLUMNS, 0]);
    expect([b.cardId, b.x, b.w]).toEqual(["c2", 0, COLUMNS]);
    expect(b.y).toBe(a.y + a.h);
  });

  it("keeps the first of a card id that appears twice", () => {
    const raw = {
      version: 1, activeTab: "t1",
      tabs: [{ id: "t1", name: "A", items: [{ cardId: "c1", x: 0, y: 0, w: 4, h: 4 }] }, { id: "t2", name: "B", items: [{ cardId: "c1", x: 0, y: 0, w: 4, h: 4 }] }],
    };
    const ws = reconcile(raw, [card("c1")]);
    expect(ws.tabs[0].items).toHaveLength(1);
    expect(ws.tabs[1].items).toHaveLength(0);
  });

  it("clamps out-of-range stored items and gives an item with a non-number the default size", () => {
    const raw = {
      version: 1, activeTab: "t",
      tabs: [{ id: "t", name: "A", items: [{ cardId: "c1", x: -3, y: 2, w: 40, h: 5 }, { cardId: "c2", x: 0, y: 0, w: 4, h: "x" }] }],
    };
    const [a, b] = reconcile(raw, [card("c1"), card("c2")]).tabs[0].items;
    expect([a.x, a.w, a.h]).toEqual([0, COLUMNS, 5]);
    expect([b.x, b.y, Number.isFinite(b.w), Number.isFinite(b.h)]).toEqual([0, 0, true, true]);
  });

  it("falls back to the first tab when the active tab does not exist", () => {
    const raw = { version: 1, activeTab: "nope", tabs: [{ id: "t", name: "A", items: [] }] };
    expect(reconcile(raw, []).activeTab).toBe("t");
  });
});

describe("workspaceStore", () => {
  it("addCard stores the config in cardStore and places the card at the first free spot of the active tab", () => {
    const a = workspaceStore.addCard(STATE, CONFIG);
    const b = workspaceStore.addCard(STATE, CONFIG);
    expect(cardStore.list(STATE).map((c) => c.id)).toEqual([a.id, b.id]);
    const [ia, ib] = read().tabs[0].items;
    expect([ia.cardId, ia.x, ia.y]).toEqual([a.id, 0, 0]);
    expect(ib.cardId).toBe(b.id);
    expect(ib.x === ia.x && ib.y === ia.y).toBe(false);
  });

  it("addCard to a named tab places it in that tab", () => {
    const tab = workspaceStore.addTab(STATE);
    const c = workspaceStore.addCard(STATE, CONFIG, read().tabs[0].id);
    expect(read().tabs[0].items.map((i) => i.cardId)).toEqual([c.id]);
    expect(read().tabs.find((t) => t.id === tab.id)!.items).toEqual([]);
  });

  it("copyCard puts the copy under the original at the same width", () => {
    const a = workspaceStore.addCard(STATE, CONFIG);
    const copy = workspaceStore.copyCard(STATE, a.id)!;
    const items = read().tabs[0].items;
    const ia = items.find((i) => i.cardId === a.id)!;
    const ic = items.find((i) => i.cardId === copy.id)!;
    expect(ic.w).toBe(ia.w);
    expect(ic.y).toBeGreaterThanOrEqual(ia.y + ia.h);
    expect(cardStore.list(STATE).find((c) => c.id === copy.id)!.config.title).toBe("Vote (copy)");
  });

  it("copyCard of an unknown card returns null", () => {
    expect(workspaceStore.copyCard(STATE, "nope")).toBeNull();
  });

  it("removeCard drops the card from its tab and from cardStore", () => {
    const a = workspaceStore.addCard(STATE, CONFIG);
    workspaceStore.removeCard(STATE, a.id);
    expect(read().tabs[0].items).toEqual([]);
    expect(cardStore.list(STATE)).toEqual([]);
  });

  it("removeCard closes the gap, so what is stored matches what the grid shows", () => {
    const a = workspaceStore.addCard(STATE, CONFIG);
    const b = workspaceStore.addCard(STATE, CONFIG);
    const tabId = read().tabs[0].id;
    workspaceStore.setItems(STATE, tabId, [{ cardId: a.id, x: 0, y: 0, w: 12, h: 8 }, { cardId: b.id, x: 0, y: 8, w: 12, h: 8 }]);
    workspaceStore.removeCard(STATE, a.id);
    expect(read().tabs[0].items).toEqual([{ cardId: b.id, x: 0, y: 0, w: 12, h: 8 }]);
  });

  it("moveCardToTab closes the gap it leaves in the old tab", () => {
    const a = workspaceStore.addCard(STATE, CONFIG);
    const b = workspaceStore.addCard(STATE, CONFIG);
    const t2 = workspaceStore.addTab(STATE);
    const first = read().tabs[0].id;
    workspaceStore.setItems(STATE, first, [{ cardId: a.id, x: 0, y: 0, w: 12, h: 8 }, { cardId: b.id, x: 0, y: 8, w: 12, h: 8 }]);
    workspaceStore.moveCardToTab(STATE, a.id, t2.id);
    expect(read().tabs[0].items.find((i) => i.cardId === b.id)!.y).toBe(0);
  });

  it("setItems stores a new layout for the tab, normalised", () => {
    const a = workspaceStore.addCard(STATE, CONFIG);
    const tabId = read().tabs[0].id;
    workspaceStore.setItems(STATE, tabId, [{ cardId: a.id, x: 99, y: 3, w: 6, h: 5 }]);
    expect(read().tabs[0].items).toEqual([{ cardId: a.id, x: 6, y: 3, w: 6, h: 5 }]);
  });

  it("addTab names it, makes it active, and renameTab trims and ignores a blank name", () => {
    const tab = workspaceStore.addTab(STATE);
    expect(read().activeTab).toBe(tab.id);
    expect(read().tabs.map((t) => t.name)).toEqual(["Tab 1", "Tab 2"]);
    workspaceStore.renameTab(STATE, tab.id, "  Zones  ");
    expect(read().tabs[1].name).toBe("Zones");
    workspaceStore.renameTab(STATE, tab.id, "   ");
    expect(read().tabs[1].name).toBe("Zones");
  });

  it("moveTab swaps order and keeps the active tab", () => {
    const t2 = workspaceStore.addTab(STATE);
    workspaceStore.moveTab(STATE, t2.id, -1);
    expect(read().tabs.map((t) => t.id)[0]).toBe(t2.id);
    expect(read().activeTab).toBe(t2.id);
    workspaceStore.moveTab(STATE, t2.id, -1); // already first
    expect(read().tabs[0].id).toBe(t2.id);
  });

  it("deleteTab returns how many cards went with it and removes them from cardStore", () => {
    const t2 = workspaceStore.addTab(STATE);
    workspaceStore.addCard(STATE, CONFIG, t2.id);
    workspaceStore.addCard(STATE, CONFIG, t2.id);
    const keep = workspaceStore.addCard(STATE, CONFIG, read().tabs[0].id);
    expect(workspaceStore.deleteTab(STATE, t2.id)).toBe(2);
    expect(cardStore.list(STATE).map((c) => c.id)).toEqual([keep.id]);
  });

  it("deleting the active tab activates a neighbour", () => {
    const t2 = workspaceStore.addTab(STATE);
    const t3 = workspaceStore.addTab(STATE);
    workspaceStore.setActiveTab(STATE, t2.id);
    workspaceStore.deleteTab(STATE, t2.id);
    expect(read().activeTab).toBe(t3.id);
    workspaceStore.deleteTab(STATE, t3.id);
    expect(read().activeTab).toBe(read().tabs[0].id);
  });

  it("the last tab cannot be deleted", () => {
    expect(() => workspaceStore.deleteTab(STATE, read().tabs[0].id)).toThrow(/last tab/);
    expect(read().tabs).toHaveLength(1);
  });

  it("moveCardToTab removes it from the old tab and places it in the new one", () => {
    const t2 = workspaceStore.addTab(STATE);
    const a = workspaceStore.addCard(STATE, CONFIG, read().tabs[0].id);
    workspaceStore.moveCardToTab(STATE, a.id, t2.id);
    expect(read().tabs[0].items).toEqual([]);
    expect(read().tabs[1].items.map((i) => i.cardId)).toEqual([a.id]);
  });

  it("each state has its own workspace", () => {
    workspaceStore.addCard(STATE, CONFIG);
    expect(read("Bihar").tabs[0].items).toEqual([]);
  });
});

describe("persistence", () => {
  it("survives a reload", () => {
    const a = workspaceStore.addCard(STATE, CONFIG);
    const t2 = workspaceStore.addTab(STATE);
    _dropMemory();
    _dropWorkspaceMemory();
    expect(read().tabs.map((t) => t.id)).toContain(t2.id);
    expect(read().tabs[0].items.map((i) => i.cardId)).toEqual([a.id]);
  });

  it("treats a corrupt stored value as an empty workspace", () => {
    localStorage.setItem(`mb.workspace.${STATE}`, "{not json");
    expect(read().tabs).toHaveLength(1);
  });

  it("falls back to memory when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const a = workspaceStore.addCard(STATE, CONFIG);
    expect(read().tabs[0].items.map((i) => i.cardId)).toEqual([a.id]);
  });

  it("a storage event from another browser tab refreshes the workspace", () => {
    workspaceStore.addTab(STATE);
    const other = { version: 1, activeTab: "z", tabs: [{ id: "z", name: "From elsewhere", items: [] }] };
    localStorage.setItem(`mb.workspace.${STATE}`, JSON.stringify(other));
    window.dispatchEvent(new StorageEvent("storage", { key: `mb.workspace.${STATE}` }));
    expect(read().tabs.map((t) => t.name)).toEqual(["From elsewhere"]);
  });

  it("a card another browser tab added appears in the first tab", () => {
    workspaceStore.addTab(STATE);
    const added = card("from-elsewhere");
    localStorage.setItem(`mb.cards.${STATE}`, JSON.stringify([added]));
    window.dispatchEvent(new StorageEvent("storage", { key: `mb.cards.${STATE}` }));
    expect(read().tabs[0].items.map((i) => i.cardId)).toEqual(["from-elsewhere"]);
  });
});

describe("removeCard and restoreCard", () => {
  it("restores the card with its id, config, tab and size, and in its old place in the list", () => {
    const a = workspaceStore.addCard(STATE, CONFIG);
    const b = workspaceStore.addCard(STATE, { ...CONFIG, title: "Second" });
    const c = workspaceStore.addCard(STATE, CONFIG);
    const placed = read().tabs[0].items.find((i) => i.cardId === b.id)!;
    const removal = workspaceStore.removeCard(STATE, b.id);
    expect(removal).not.toBeNull();
    expect(cardStore.list(STATE).map((x) => x.id)).toEqual([a.id, c.id]);
    workspaceStore.restoreCard(STATE, removal!);
    expect(cardStore.list(STATE).map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    expect(cardStore.list(STATE)[1].config.title).toBe("Second");
    const items = read().tabs[0].items;
    expect(items).toHaveLength(3);
    expect(items.find((i) => i.cardId === b.id)).toMatchObject({ w: placed.w, h: placed.h });
  });

  it("removeCard returns null for a card that is not stored, and restoring twice adds it once", () => {
    expect(workspaceStore.removeCard(STATE, "nope")).toBeNull();
    const a = workspaceStore.addCard(STATE, CONFIG);
    const removal = workspaceStore.removeCard(STATE, a.id)!;
    workspaceStore.restoreCard(STATE, removal);
    workspaceStore.restoreCard(STATE, removal);
    expect(cardStore.list(STATE)).toHaveLength(1);
    expect(read().tabs[0].items).toHaveLength(1);
  });

  it("puts a card back into the first tab when the tab it left has been deleted", () => {
    const a = workspaceStore.addCard(STATE, CONFIG);
    workspaceStore.addTab(STATE);
    const second = read().tabs[1];
    workspaceStore.moveCardToTab(STATE, a.id, second.id);
    const removal = workspaceStore.removeCard(STATE, a.id)!;
    workspaceStore.deleteTab(STATE, second.id);
    workspaceStore.restoreCard(STATE, removal);
    expect(read().tabs).toHaveLength(1);
    expect(read().tabs[0].items.map((i) => i.cardId)).toEqual([a.id]);
  });
});
