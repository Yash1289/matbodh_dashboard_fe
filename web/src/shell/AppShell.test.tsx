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
    for (const label of ["Cards", "Seat Battleground", "Voter Coalitions", "Leadership", "Vote Movement", "My cards", "+ Add a cut"]) {
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", expect.stringContaining(CONTEXT_QUERY));
    }
    expect(within(nav).getByText("SECTIONS")).toBeInTheDocument();
    expect(within(nav).getByText("MINE")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Cards" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Vote Movement" })).not.toHaveAttribute("aria-current");
    expect(within(nav).queryByRole("link", { name: "State Pulse" })).toBeNull();
    await screen.findByRole("table");
  });

  it("placeholder pages keep the full section name", async () => {
    stubCardApi({ payloads: [CARD()] });
    renderWithProviders(<AppRoutes />, { route: `/leadership${CONTEXT_QUERY}` });
    expect(await screen.findByText("Leadership & Anti-incumbency arrives in phase 2")).toBeInTheDocument();
    await screen.findByTestId("context-pill");
    await waitFor(() => expect(screen.getByTestId("context-pill")).toHaveTextContent("Geo: whole state"));
  });

  it("renders the cards page at / and sends unknown paths there", async () => {
    stubCardApi({ payloads: [CARD()] });
    renderWithProviders(<AppRoutes />, { route: `/nowhere${CONTEXT_QUERY}` });
    expect(await screen.findByRole("heading", { name: "Cards" })).toBeInTheDocument();
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});
