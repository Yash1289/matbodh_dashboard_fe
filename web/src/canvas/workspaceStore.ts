import { useMemo, useSyncExternalStore } from "react";
import type { CardConfigJson, Family } from "../api/types";
import { cardStore, useStoredCards, type StoredCard } from "../configure/cardStore";
import { defaultSize, firstFreeSpot, normalise, settle, COLUMNS, type Item } from "./layout";

// The analyst's arrangement lives in this browser until the database phase (6c): one record per state in
// localStorage, mirrored in memory. It references cards by id; their configs stay in `cardStore`.
// Storage can throw (private windows, blocked data); memory still works, as in `cardStore`.
export interface Tab { id: string; name: string; items: Item[] }
export interface Workspace { version: 1; activeTab: string; tabs: Tab[] }

const memory = new Map<string, unknown>();
const listeners = new Set<() => void>();
const storageKey = (state: string) => `mb.workspace.${state}`;
const emit = () => listeners.forEach((l) => l());

const newId = (prefix: string): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? `${prefix}-${crypto.randomUUID()}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function freshTab(): Tab { return { id: "tab-1", name: "Tab 1", items: [] }; }

function readItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (!isObject(r) || typeof r.cardId !== "string") return [];
    const [x, y, w, h] = [r.x, r.y, r.w, r.h].map((n) => (typeof n === "number" ? n : Number.NaN));
    return [normalise({ cardId: r.cardId, x, y, w, h })];
  });
}

/**
 * The stored workspace made consistent with the cards that exist: unusable data gives a fresh one-tab
 * workspace, items are clamped into the grid, items for missing cards and repeated card ids are dropped,
 * and a card no tab holds goes into the first tab at full width, one per row.
 */
export function reconcile(raw: unknown, cards: StoredCard[]): Workspace {
  const known = new Map(cards.map((c) => [c.id, c]));
  const stored = isObject(raw) && raw.version === 1 && Array.isArray(raw.tabs) ? raw.tabs : [];
  const seen = new Set<string>();
  const tabs: Tab[] = stored.flatMap((t) => {
    if (!isObject(t) || typeof t.id !== "string" || typeof t.name !== "string") return [];
    const items = readItems(t.items).filter((i) => known.has(i.cardId) && !seen.has(i.cardId) && seen.add(i.cardId));
    return [{ id: t.id, name: t.name, items }];
  });
  if (tabs.length === 0) tabs.push(freshTab());
  const first = tabs[0];
  let bottom = first.items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  for (const c of cards) {
    if (seen.has(c.id)) continue;
    const h = defaultSize(c.config.family as Family).h;
    first.items.push({ cardId: c.id, x: 0, y: bottom, w: COLUMNS, h });
    bottom += h;
  }
  const active = isObject(raw) && typeof raw.activeTab === "string" && tabs.some((t) => t.id === raw.activeTab) ? raw.activeTab : first.id;
  return { version: 1, activeTab: active, tabs };
}

function loadRaw(state: string): unknown {
  try {
    const text = localStorage.getItem(storageKey(state));
    const parsed: unknown = text === null ? null : JSON.parse(text);
    memory.set(state, parsed);
    return parsed;
  } catch {
    // unreadable, corrupt or unavailable storage: keep what this tab has (never an error on the page)
    return memory.get(state) ?? null;
  }
}

const readRaw = (state: string): unknown => (memory.has(state) ? memory.get(state) : loadRaw(state));

function write(state: string, ws: Workspace): void {
  memory.set(state, ws);
  try {
    localStorage.setItem(storageKey(state), JSON.stringify(ws));
  } catch {
    // memory only
  }
  emit();
}

/** The workspace as stored now (another browser tab may have written since). */
const current = (state: string): Workspace => reconcile(loadRaw(state), cardStore.list(state));

const tabOf = (ws: Workspace, cardId: string): Tab | undefined => ws.tabs.find((t) => t.items.some((i) => i.cardId === cardId));
const withTab = (ws: Workspace, tabId: string, change: (t: Tab) => Tab): Workspace => ({ ...ws, tabs: ws.tabs.map((t) => (t.id === tabId ? change(t) : t)) });

/** Everything needed to put a removed card back: the stored card, its place in the list, and its tab and size. */
export interface Removal { card: StoredCard; index: number; tabId: string; item: Item }

export const workspaceStore = {
  get: (state: string): Workspace => reconcile(readRaw(state), cardStore.list(state)),

  /** Store the config and place the card at the first free spot of the tab (default: the active tab). */
  addCard(state: string, config: CardConfigJson, tabId?: string): StoredCard {
    const ws = current(state);
    const stored = cardStore.add(state, config);
    const target = ws.tabs.find((t) => t.id === tabId) ?? ws.tabs.find((t) => t.id === ws.activeTab) ?? ws.tabs[0];
    const size = defaultSize(config.family as Family);
    const spot = firstFreeSpot(target.items, size);
    write(state, withTab(ws, target.id, (t) => ({ ...t, items: [...t.items, { cardId: stored.id, ...spot, ...size }] })));
    return stored;
  },

  /** A copy of the card placed directly below it at the same width. */
  copyCard(state: string, cardId: string): StoredCard | null {
    const ws = current(state);
    const home = tabOf(ws, cardId);
    const source = home?.items.find((i) => i.cardId === cardId);
    if (home === undefined || source === undefined) return null;
    const copy = cardStore.copy(state, cardId);
    if (copy === null) return null;
    write(state, withTab(ws, home.id, (t) => ({ ...t, items: settle([...t.items, { ...source, cardId: copy.id, y: source.y + source.h }]) })));
    return copy;
  },

  removeCard(state: string, cardId: string): Removal | null {
    const ws = current(state);
    const index = cardStore.list(state).findIndex((c) => c.id === cardId);
    const home = tabOf(ws, cardId);
    const item = home?.items.find((i) => i.cardId === cardId);
    if (index < 0 || home === undefined || item === undefined) return null;
    const card = cardStore.list(state)[index];
    cardStore.remove(state, cardId);
    // Close the gap, so the stored layout is what the grid shows.
    write(state, { ...ws, tabs: ws.tabs.map((t) => ({ ...t, items: settle(t.items.filter((i) => i.cardId !== cardId)) })) });
    return { card, index, tabId: home.id, item };
  },

  /** Undo a removal: the card returns under its own id to its tab (the first, if that tab is gone) and is settled into the layout. */
  restoreCard(state: string, removal: Removal): void {
    if (cardStore.list(state).some((c) => c.id === removal.card.id)) return;
    cardStore.restore(state, removal.card, removal.index);
    // The store now holds a card no tab does; place it where it was instead of where reconcile would put it.
    const ws = current(state);
    const home = ws.tabs.find((t) => t.id === removal.tabId) ?? ws.tabs[0];
    write(state, {
      ...ws,
      tabs: ws.tabs.map((t) => {
        const rest = t.items.filter((i) => i.cardId !== removal.card.id);
        return t.id === home.id ? { ...t, items: settle([...rest, removal.item]) } : { ...t, items: rest };
      }),
    });
  },

  /** A new layout for one tab (after a drag, resize or keyboard action). Unknown cards are ignored. */
  setItems(state: string, tabId: string, items: Item[]): void {
    const ws = current(state);
    const known = new Set(cardStore.list(state).map((c) => c.id));
    write(state, withTab(ws, tabId, (t) => ({ ...t, items: items.filter((i) => known.has(i.cardId)).map(normalise) })));
  },

  moveCardToTab(state: string, cardId: string, tabId: string): void {
    const ws = current(state);
    const from = tabOf(ws, cardId);
    const item = from?.items.find((i) => i.cardId === cardId);
    if (from === undefined || item === undefined || from.id === tabId || !ws.tabs.some((t) => t.id === tabId)) return;
    const target = ws.tabs.find((t) => t.id === tabId)!;
    const spot = firstFreeSpot(target.items, item);
    write(state, {
      ...ws,
      tabs: ws.tabs.map((t) => (t.id === from.id ? { ...t, items: settle(t.items.filter((i) => i.cardId !== cardId)) }
        : t.id === tabId ? { ...t, items: [...t.items, { ...item, ...spot }] } : t)),
    });
  },

  addTab(state: string): Tab {
    const ws = current(state);
    const tab: Tab = { id: newId("tab"), name: `Tab ${ws.tabs.length + 1}`, items: [] };
    write(state, { ...ws, tabs: [...ws.tabs, tab], activeTab: tab.id });
    return tab;
  },

  renameTab(state: string, tabId: string, name: string): void {
    const trimmed = name.trim();
    if (trimmed === "") return;
    write(state, withTab(current(state), tabId, (t) => ({ ...t, name: trimmed })));
  },

  moveTab(state: string, tabId: string, by: -1 | 1): void {
    const ws = current(state);
    const from = ws.tabs.findIndex((t) => t.id === tabId);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ws.tabs.length) return;
    const tabs = [...ws.tabs];
    [tabs[from], tabs[to]] = [tabs[to], tabs[from]];
    write(state, { ...ws, tabs });
  },

  /** Removes the tab and its cards; returns how many cards went with it. The last tab cannot be deleted. */
  deleteTab(state: string, tabId: string): number {
    const ws = current(state);
    const index = ws.tabs.findIndex((t) => t.id === tabId);
    if (index < 0) return 0;
    if (ws.tabs.length === 1) throw new Error("The last tab cannot be deleted");
    const gone = ws.tabs[index];
    gone.items.forEach((i) => cardStore.remove(state, i.cardId));
    const tabs = ws.tabs.filter((t) => t.id !== tabId);
    const activeTab = ws.activeTab === tabId ? tabs[Math.min(index, tabs.length - 1)].id : ws.activeTab;
    write(state, { ...ws, tabs, activeTab });
    return gone.items.length;
  },

  setActiveTab(state: string, tabId: string): void {
    const ws = current(state);
    if (ws.tabs.some((t) => t.id === tabId)) write(state, { ...ws, activeTab: tabId });
  },
};

/** Tests only: forget the in-memory copy, as a page reload does. */
export const _dropWorkspaceMemory = (): void => memory.clear();

// Another browser tab changed its workspace: forget this tab's copy so the next read takes the stored one.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === null) memory.clear();
    else if (e.key.startsWith("mb.workspace.")) memory.delete(e.key.slice("mb.workspace.".length));
    else return;
    emit();
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const EMPTY: Workspace = reconcile(null, []);

/** The workspace for a state, consistent with its cards; re-renders on any change to either. */
export function useWorkspace(state: string | null): Workspace {
  const cards = useStoredCards(state);
  const raw = useSyncExternalStore(subscribe, () => (state === null ? null : readRaw(state)));
  return useMemo(() => (state === null ? EMPTY : reconcile(raw, cards)), [state, raw, cards]);
}
