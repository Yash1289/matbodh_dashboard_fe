import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CohortRef } from "../api/types";
import { _dropMemory, clearCohort, setCohort, useSessionCohort } from "./cohortStore";

const COHORT: CohortRef = { seat_level: "ac", seat_ids: [3, 12], label: "Top 2 AC", created_at: "2026-11-18T00:00:00Z" };

afterEach(() => {
  clearCohort("Uttar Pradesh");
  clearCohort("Bihar");
  vi.restoreAllMocks();
});

describe("session cohort store", () => {
  it("holds a cohort per state and clears it", () => {
    const { result } = renderHook(() => useSessionCohort("Uttar Pradesh"));
    expect(result.current).toBeNull();
    act(() => setCohort("Uttar Pradesh", COHORT));
    expect(result.current).toEqual(COHORT);
    act(() => clearCohort("Uttar Pradesh"));
    expect(result.current).toBeNull();
  });

  it("a cohort for one state is never returned for another", () => {
    act(() => setCohort("Uttar Pradesh", COHORT));
    const { result } = renderHook(() => useSessionCohort("Bihar"));
    expect(result.current).toBeNull();
  });

  it("survives losing the in-memory copy (a reload in the same tab) through session storage", () => {
    act(() => setCohort("Uttar Pradesh", COHORT));
    _dropMemory();
    const { result } = renderHook(() => useSessionCohort("Uttar Pradesh"));
    expect(result.current).toEqual(COHORT);
  });

  it("works in memory when session storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const { result } = renderHook(() => useSessionCohort("Uttar Pradesh"));
    act(() => setCohort("Uttar Pradesh", COHORT));
    expect(result.current).toEqual(COHORT);
  });

  it("no state means no cohort", () => {
    expect(renderHook(() => useSessionCohort(null)).result.current).toBeNull();
  });
});
