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

function read(state: string): StoredCard[] {
  const held = memory.get(state);
  if (held !== undefined) return held;
  let cards: StoredCard[] = [];
  try {
    const raw = localStorage.getItem(storageKey(state));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (Array.isArray(parsed)) cards = parsed as StoredCard[];
  } catch {
    // unreadable or unavailable storage: no cards (never an error on the page)
  }
  memory.set(state, cards);
  return cards;
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
    write(state, [...read(state), stored]);
    return stored;
  },

  replace(state: string, id: string, config: CardConfigJson): void {
    write(state, read(state).map((c) => (c.id === id ? { id, config: withId(config, id) } : c)));
  },

  remove(state: string, id: string): void {
    write(state, read(state).filter((c) => c.id !== id));
  },

  /** A new card with the same config (its title says "copy"); null if the card is not stored. */
  copy(state: string, id: string): StoredCard | null {
    const source = read(state).find((c) => c.id === id);
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

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// useSyncExternalStore needs a stable snapshot: the per-state array identity only changes on write.
export const useStoredCards = (state: string | null): StoredCard[] =>
  useSyncExternalStore(subscribe, () => (state === null ? NONE : read(state)));
const NONE: StoredCard[] = [];
