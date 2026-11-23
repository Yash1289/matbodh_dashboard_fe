import { useSyncExternalStore } from "react";
import type { CohortRef } from "../api/types";

// The cohort lives only in this browser session (spec 5.1): in memory, mirrored to sessionStorage so a
// reload of the same tab keeps it. Storage can throw (private windows, blocked data); memory still works.
const memory = new Map<string, CohortRef>();
const listeners = new Set<() => void>();
const storageKey = (state: string) => `mb.cohort.${state}`;
const emit = () => listeners.forEach((l) => l());

export function getCohort(state: string): CohortRef | null {
  const held = memory.get(state);
  if (held !== undefined) return held;
  try {
    const raw = sessionStorage.getItem(storageKey(state));
    if (raw !== null) {
      const cohort = JSON.parse(raw) as CohortRef;
      memory.set(state, cohort);
      return cohort;
    }
  } catch {
    // unreadable or unavailable storage: no cohort
  }
  return null;
}

export function setCohort(state: string, cohort: CohortRef): void {
  memory.set(state, cohort);
  try {
    sessionStorage.setItem(storageKey(state), JSON.stringify(cohort));
  } catch {
    // memory only
  }
  emit();
}

/** A new name for the cohort of a state; the seats stay. A blank name changes nothing. */
export function renameCohort(state: string, label: string): void {
  const held = getCohort(state);
  const next = label.trim().slice(0, 120);
  if (held !== null && next !== "") setCohort(state, { ...held, label: next });
}

export function clearCohort(state: string): void {
  memory.delete(state);
  try {
    sessionStorage.removeItem(storageKey(state));
  } catch {
    // memory only
  }
  emit();
}

/** Tests only: forget the in-memory copy, as a page reload does. */
export const _dropMemory = (): void => memory.clear();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The session cohort of a state (null for none or for no state). */
export const useSessionCohort = (state: string | null): CohortRef | null =>
  useSyncExternalStore(subscribe, () => (state === null ? null : getCohort(state)));
