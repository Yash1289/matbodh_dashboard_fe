import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { CONTEXT_QUERY, PAYLOADS, stubCardApi } from "../test/cardApi";
import { renderWithProviders } from "../test/render";

const CARD = () => PAYLOADS.distributionStandalone();

afterEach(() => vi.unstubAllGlobals());

describe("shell", () => {
  it("top bar shows brand, context pill and Edit context", async () => {
    stubCardApi({ payloads: [CARD()] });
    renderWithProviders(<AppRoutes />, { route: `/${CONTEXT_QUERY}` });
    expect(screen.getByText("MatBodh")).toBeInTheDocument();
    const pill = await screen.findByTestId("context-pill");
    await waitFor(() => expect(pill).toHaveTextContent(/^Uttar Pradesh · AC level · .* · Geo: whole state$/));
    expect(screen.getByRole("button", { name: "Edit context" })).toBeInTheDocument();
    expect(screen.queryByText("+ Add state")).not.toBeInTheDocument();
    await screen.findByRole("table");
  });

  it("nav labels and active style", async () => {
    stubCardApi({ payloads: [CARD()] });
    renderWithProviders(<AppRoutes />, { route: `/${CONTEXT_QUERY}` });
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["Cards"]);
    expect(within(nav).getByRole("link", { name: "Cards" })).toHaveAttribute("href", expect.stringContaining(CONTEXT_QUERY));
    expect(within(nav).getByRole("link", { name: "Cards" })).toHaveAttribute("aria-current", "page");
    // The dropped State Pulse sections and the old "+ Add a cut" builder are gone (Configure's Add card replaces it).
    for (const gone of ["State Pulse", "Seat Battleground", "Voter Coalitions", "Leadership", "Vote Movement", "My cards", "+ Add a cut"]) {
      expect(within(nav).queryByRole("link", { name: gone })).toBeNull();
    }
    await screen.findByRole("table");
  });

  it("an old placeholder path goes to the cards page", async () => {
    stubCardApi({ payloads: [CARD()] });
    renderWithProviders(<AppRoutes />, { route: `/leadership${CONTEXT_QUERY}` });
    expect(await screen.findByRole("heading", { name: "Cards" })).toBeInTheDocument();
    expect(screen.queryByText(/arrives in phase/)).toBeNull();
  });

  it("renders the cards page at / and sends unknown paths there", async () => {
    stubCardApi({ payloads: [CARD()] });
    renderWithProviders(<AppRoutes />, { route: `/nowhere${CONTEXT_QUERY}` });
    expect(await screen.findByRole("heading", { name: "Cards" })).toBeInTheDocument();
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});
