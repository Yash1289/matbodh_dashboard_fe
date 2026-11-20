import type { StateContext } from "../api/types";
import { parseContext, serialiseContext } from "./urlContext";

const KEY = "mb.lastContext";

/** Remember the context the analyst last continued with, so the starting page can offer it again. A per-viewer convenience. */
export function saveLastContext(ctx: StateContext): void {
  try {
    // The cohort is session-only and never stored.
    const { cohort: _cohort, ...plain } = ctx;
    localStorage.setItem(KEY, serialiseContext(plain).toString());
  } catch { /* blocked storage: the starting page just offers nothing */ }
}

export function readLastContext(): StateContext | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : parseContext(new URLSearchParams(raw));
  } catch {
    return null;
  }
}
