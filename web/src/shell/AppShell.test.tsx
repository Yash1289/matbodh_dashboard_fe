import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearCohort, setCohort } from "../cohorts/cohortStore";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { _dropWorkspaceMemory } from "../canvas/workspaceStore";
import { _dropMemory } from "../configure/cardStore";
import { CONTEXT_QUERY, PAYLOADS, seedStoredCards, stubCardApi } from "../test/cardApi";
import { renderWithProviders } from "../test/render";

const CARD = () => PAYLOADS.distributionStandalone();

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  _dropMemory();
  _dropWorkspaceMemory();
});

/** The engine serves one card; the analyst has it on their canvas. */
function mountCard() {
  const card = CARD();
  stubCardApi({ payloads: [card] });
  seedStoredCards("Uttar Pradesh", [card]);
}

describe("shell", () => {
  it("top bar shows brand, context pill and Edit context", async () => {
    mountCard();
    renderWithProviders(<AppRoutes />, { route: `/${CONTEXT_QUERY}` });
    expect(screen.getByText("MatBodh")).toBeInTheDocument();
    const pill = await screen.findByTestId("context-pill");
    await waitFor(() => expect(pill).toHaveTextContent(/^Uttar Pradesh · AC level · .* · Geo: whole state$/));
    expect(screen.getByRole("button", { name: "Edit context" })).toBeInTheDocument();
    expect(screen.queryByText("+ Add state")).not.toBeInTheDocument();
    await screen.findByRole("table");
  });

  it("the sidebar manages tabs: no Cards link, the active tab is marked, New tab adds and opens one", async () => {
    mountCard();
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: `/${CONTEXT_QUERY}` });
    const nav = screen.getByRole("navigation", { name: "Tabs" });
    expect(within(nav).queryByRole("link")).toBeNull();
    expect(within(nav).getByRole("tab", { name: "Tab 1" })).toHaveAttribute("aria-selected", "true");
    await user.click(within(nav).getByRole("button", { name: "New tab" }));
    expect(within(nav).getByRole("tab", { name: "Tab 2" })).toHaveAttribute("aria-selected", "true");
    // The page names the tab it shows, and keeps the Add card action.
    expect(await screen.findByRole("heading", { level: 1, name: "Tab 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add card" })).toBeInTheDocument();
  });

  it("with no context there are no tabs to manage, so no sidebar", async () => {
    stubCardApi({ payloads: [] });
    renderWithProviders(<AppRoutes />, { route: "/" });
    expect(await screen.findByRole("heading", { level: 1, name: "Survey context" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Tabs" })).toBeNull();
    expect(screen.queryByRole("button", { name: /sidebar/ })).toBeNull();
  });

  it("an old placeholder path goes to the cards page", async () => {
    mountCard();
    renderWithProviders(<AppRoutes />, { route: `/leadership${CONTEXT_QUERY}` });
    expect(await screen.findByRole("heading", { level: 1, name: "Tab 1" })).toBeInTheDocument();
    expect(screen.queryByText(/arrives in phase/)).toBeNull();
  });

  it("renders the cards page at / and sends unknown paths there", async () => {
    mountCard();
    renderWithProviders(<AppRoutes />, { route: `/nowhere${CONTEXT_QUERY}` });
    expect(await screen.findByRole("heading", { level: 1, name: "Tab 1" })).toBeInTheDocument();
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("the sidebar hides and shows, keeps the choice, and the button says which", async () => {
    mountCard();
    const user = userEvent.setup();
    const first = renderWithProviders(<AppRoutes />, { route: `/${CONTEXT_QUERY}` });
    const toggle = await screen.findByRole("button", { name: "Hide sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "Tabs" })).toBeVisible();
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Show sidebar" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Tabs", hidden: true })).toBeNull();
    first.unmount();
    renderWithProviders(<AppRoutes />, { route: `/${CONTEXT_QUERY}` });
    expect(await screen.findByRole("button", { name: "Show sidebar" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(screen.getByRole("navigation", { name: "Tabs" })).toBeVisible();
  });

  it("the session cohort is a sub-tab under the active tab; it opens the cohort and the tab returns to the cards", async () => {
    mountCard();
    const user = userEvent.setup();
    setCohort("Uttar Pradesh", { seat_level: "ac", seat_ids: [3, 12], label: "Top 2 AC", created_at: "2026-11-18T00:00:00Z" });
    try {
      renderWithProviders(<AppRoutes />, { route: `/${CONTEXT_QUERY}` });
      const nav = screen.getByRole("navigation", { name: "Tabs" });
      await user.click(within(nav).getByRole("tab", { name: /^Cohort/ }));
      expect(await screen.findByRole("heading", { level: 1, name: "Cohort" })).toBeInTheDocument();
      expect(within(nav).getByRole("tab", { name: /^Cohort/ })).toHaveAttribute("aria-selected", "true");
      await user.click(within(nav).getByRole("tab", { name: "Tab 1" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Tab 1" })).toBeInTheDocument();
    } finally {
      clearCohort("Uttar Pradesh");
    }
  });

  describe("on a narrow window", () => {
    const narrow = () => vi.stubGlobal("matchMedia", (query: string) => ({
      matches: /max-width/.test(query), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }));

    it("starts hidden, opens over the page, and closes on Escape or when a tab is chosen", async () => {
      mountCard();
      narrow();
      const user = userEvent.setup();
      renderWithProviders(<AppRoutes />, { route: `/${CONTEXT_QUERY}` });
      const toggle = await screen.findByRole("button", { name: "Show sidebar" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).not.toHaveAttribute("aria-controls"); // nothing to control until it exists
      expect(screen.queryByRole("navigation", { name: "Tabs" })).toBeNull();
      await user.click(toggle);
      const nav = await screen.findByRole("navigation", { name: "Tabs" });
      expect(screen.getByRole("dialog")).toContainElement(nav);
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("navigation", { name: "Tabs" })).toBeNull());
      await user.click(screen.getByRole("button", { name: "Show sidebar" }));
      await user.click(within(await screen.findByRole("navigation", { name: "Tabs" })).getByRole("tab", { name: "Tab 1" }));
      await waitFor(() => expect(screen.queryByRole("navigation", { name: "Tabs" })).toBeNull());
    });

    it("the saved wide-window choice is left alone", async () => {
      mountCard();
      narrow();
      const user = userEvent.setup();
      renderWithProviders(<AppRoutes />, { route: `/${CONTEXT_QUERY}` });
      await user.click(await screen.findByRole("button", { name: "Show sidebar" }));
      await screen.findByRole("navigation", { name: "Tabs" });
      expect(localStorage.getItem("mb.nav.open")).toBeNull();
    });
  });
});
