import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CohortRef, StateContext } from "../api/types";
import { BenchmarkCard } from "../cards/benchmark/BenchmarkCard";
import { RankingCard } from "../cards/ranking/RankingCard";
import { serialiseContext, useDashboardContext } from "../context/urlContext";
import { BENCHMARK, CONTEXT_QUERY, PAYLOADS, RANKED, infoFor, stubCardApi } from "../test/cardApi";
import { renderWithProviders } from "../test/render";
import { _dropMemory, clearCohort, setCohort } from "./cohortStore";
import { CohortTab } from "./CohortTab";

const COHORT: CohortRef = { seat_level: "ac", seat_ids: [3, 12], label: "Top 2 AC · R2", created_at: "2026-11-18T00:00:00Z" };
const STATE = "Uttar Pradesh";
const CTX: StateContext = {
  state: STATE, level: "ac", rounds: ["R1", "R2"], compare_round: "R1", anchor_round: "R2",
  version_mode: "extrapolated", geo_scope: "state",
};

afterEach(() => {
  clearCohort(STATE);
  _dropMemory();
  vi.unstubAllGlobals();
});

describe("the session cohort in the dashboard context", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[`/${CONTEXT_QUERY}`]}>{children}</MemoryRouter>
  );

  it("is merged into the context the cards send, and never written to the URL", () => {
    const { result } = renderHook(() => useDashboardContext(), { wrapper });
    expect(result.current.ctx?.cohort ?? null).toBeNull();
    act(() => setCohort(STATE, COHORT));
    expect(result.current.ctx?.cohort).toEqual(COHORT);
    expect(serialiseContext(result.current.ctx!).toString()).not.toContain("cohort");
  });
});

describe("the cohort action on cards", () => {
  const openMenu = async () => userEvent.click(await screen.findByRole("button", { name: "⋯" }));

  it("a seat ranking card offers Make cohort", async () => {
    const p = RANKED.seatStandalone();
    stubCardApi({ payloads: [p] });
    renderWithProviders(<RankingCard info={infoFor(p)} ctx={CTX} />);
    await openMenu();
    expect(await screen.findByRole("menuitem", { name: "Make cohort…" })).toBeInTheDocument();
  });

  it("a benchmark card offers Make cohort", async () => {
    const p = BENCHMARK.surveyVs2022();
    stubCardApi({ payloads: [p] });
    renderWithProviders(<BenchmarkCard info={infoFor(p)} ctx={CTX} />);
    await openMenu();
    expect(await screen.findByRole("menuitem", { name: "Make cohort…" })).toBeInTheDocument();
  });

  it("a demographic ranking card does not", async () => {
    const p = RANKED.demographic();
    stubCardApi({ payloads: [p] });
    renderWithProviders(<RankingCard info={infoFor(p)} ctx={CTX} />);
    await openMenu();
    await screen.findByRole("menuitem", { name: "Refresh" });
    expect(screen.queryByRole("menuitem", { name: "Make cohort…" })).not.toBeInTheDocument();
  });
});

describe("CohortTab", () => {
  const overall = () => ({ ...PAYLOADS.distributionStandalone(), card_id: "distribution.overall_vote_share" });

  it("without a cohort says how to make one", async () => {
    stubCardApi({ payloads: [overall()] });
    renderWithProviders(<CohortTab />, { route: `/cohort${CONTEXT_QUERY}` });
    expect(await screen.findByText(/No cohort is active/)).toBeInTheDocument();
  });

  it("with a cohort shows its label and count and runs the overall card under it, and Clear removes it", async () => {
    const api = stubCardApi({ payloads: [overall()] });
    setCohort(STATE, COHORT);
    renderWithProviders(<CohortTab />, { route: `/cohort${CONTEXT_QUERY}` });
    expect(await screen.findByText("Top 2 AC · R2")).toBeInTheDocument();
    expect(screen.getByText(/2 AC seats/)).toBeInTheDocument();
    await waitFor(() => {
      const run = api.mock.calls.find(([url]) => String(url) === "/api/cards/run");
      expect(run).toBeDefined();
      expect(JSON.parse(String(run![1]!.body)).context.cohort).toEqual(COHORT);
    });
    await userEvent.click(screen.getByRole("button", { name: "Clear cohort" }));
    expect(await screen.findByText(/No cohort is active/)).toBeInTheDocument();
  });

  it("is a canvas of its own: the first card is started for the analyst and more can be added", async () => {
    stubCardApi({ payloads: [overall()] });
    setCohort(STATE, COHORT);
    renderWithProviders(<CohortTab />, { route: `/cohort${CONTEXT_QUERY}` });
    expect(await screen.findByRole("button", { name: "Add card" })).toBeInTheDocument();
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
    const { workspaceStore, COHORT_TAB_ID } = await import("../canvas/workspaceStore");
    expect(workspaceStore.get(STATE).tabs.some((t) => t.id === COHORT_TAB_ID)).toBe(false); // never listed among the tabs
    const stored = JSON.parse(localStorage.getItem(`mb.workspace.${STATE}`)!) as { tabs: { id: string; items: unknown[] }[] };
    expect(stored.tabs.find((t) => t.id === COHORT_TAB_ID)!.items).toHaveLength(1); // started once, not once per render
  });

  it("renames the cohort on its page, keeping the seats", async () => {
    stubCardApi({ payloads: [overall()] });
    setCohort(STATE, COHORT);
    renderWithProviders(<CohortTab />, { route: `/cohort${CONTEXT_QUERY}` });
    await userEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const box = screen.getByRole("textbox", { name: "Cohort name" });
    await userEvent.clear(box);
    await userEvent.type(box, "Swing seats{Enter}");
    expect(await screen.findByText("Swing seats")).toBeInTheDocument();
    expect(screen.getByText(/2 AC seats/)).toBeInTheDocument();
  });
});
