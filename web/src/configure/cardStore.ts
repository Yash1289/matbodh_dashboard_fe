import { useSyncExternalStore } from "react";
import type { CardConfigJson, CardInfo } from "../api/types";

// The analyst's cards live in this browser (spec 9) until the database phase: a per-state list in
// localStorage, mirrored in memory. Storage can throw (private windows, blocked data); memory still works.
export interface StoredCard { id: string; config: CardConfigJson }

const memory = new Map<string, StoredCard[]>();
const listeners = new Set<() => void>();
const storageKey = (state: string) => `mb.cards.${state}`;
const emit = () => listeners.forEach((l) => l());

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `card-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** The list as stored now (another tab may have written since); memory when storage cannot be read. */
function load(state: string): StoredCard[] {
  try {
    const raw = localStorage.getItem(storageKey(state));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    const cards = Array.isArray(parsed) ? (parsed as StoredCard[]) : [];
    memory.set(state, cards);
    return cards;
  } catch {
    // unreadable or unavailable storage: keep what this tab has (never an error on the page)
    return memory.get(state) ?? [];
  }
}

function read(state: string): StoredCard[] {
  return memory.get(state) ?? load(state);
}

function write(state: string, cards: StoredCard[]): void {
  memory.set(state, cards);
  try {
    localStorage.setItem(storageKey(state), JSON.stringify(cards));
  } catch {
    // memory only
  }
  emit();
}

const withId = (config: CardConfigJson, id: string): CardConfigJson => ({ ...config, id });

export const cardStore = {
  list: (state: string): StoredCard[] => read(state),

  add(state: string, config: CardConfigJson): StoredCard {
    const id = newId();
    const stored = { id, config: withId(config, id) };
    write(state, [...load(state), stored]);
    return stored;
  },

  replace(state: string, id: string, config: CardConfigJson): void {
    write(state, load(state).map((c) => (c.id === id ? { id, config: withId(config, id) } : c)));
  },

  remove(state: string, id: string): void {
    write(state, load(state).filter((c) => c.id !== id));
  },

  /** A new card with the same config (its title says "copy"); null if the card is not stored. */
  copy(state: string, id: string): StoredCard | null {
    const source = load(state).find((c) => c.id === id);
    if (source === undefined) return null;
    return this.add(state, { ...source.config, title: `${source.config.title} (copy)` });
  },
};

/** The config of a library card, to store as the analyst's own copy (a later change to the library does not touch it). */
export function configOfInfo(info: CardInfo): CardConfigJson {
  const { meta: _meta, inline: _inline, ...config } = info;
  return config as unknown as CardConfigJson;
}

/** What "Copy config" puts on the clipboard: one YAML list item (JSON is valid YAML), with its id, ready to paste under `cards:`. */
export const copyConfigText = (config: CardConfigJson): string => `- ${JSON.stringify(config)}`;

/** Tests only: forget the in-memory copy, as a page reload does. */
export const _dropMemory = (): void => memory.clear();

// Another tab changed its cards: forget this tab's copy so the next read takes the stored list.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === null) memory.clear();
    else if (e.key.startsWith("mb.cards.")) memory.delete(e.key.slice("mb.cards.".length));
    else return;
    emit();
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// useSyncExternalStore needs a stable snapshot: the per-state array identity only changes on write.
export const useStoredCards = (state: string | null): StoredCard[] =>
  useSyncExternalStore(subscribe, () => (state === null ? NONE : read(state)));
const NONE: StoredCard[] = [];
