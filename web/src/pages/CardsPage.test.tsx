import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTEXT_QUERY, PAYLOADS, RANKED, stubCardApi } from "../test/cardApi";
import { renderWithProviders } from "../test/render";
import { CardsPage } from "./CardsPage";

afterEach(() => vi.unstubAllGlobals());

describe("CardsPage", () => {
  it("renders one CardShell per card", async () => {
    const payloads = [PAYLOADS.distributionStandalone(), PAYLOADS.opinionStandalone(), PAYLOADS.genderStandalone()];
    stubCardApi({ payloads });
    renderWithProviders(<CardsPage />, { route: `/${CONTEXT_QUERY}` });
    for (const p of payloads) expect(await screen.findByRole("heading", { name: `Card ${p.card_id}` })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("table")).toHaveLength(3));
  });

  it("routes ranking families to the ranking card and grid families to the grid card", async () => {
    const grid = PAYLOADS.distributionStandalone();
    const ranked = RANKED.seatTrend();
    stubCardApi({ payloads: [grid, ranked] });
    renderWithProviders(<CardsPage />, { route: `/${CONTEXT_QUERY}` });
    expect(await screen.findByRole("heading", { name: `Card ${ranked.card_id}` })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: `Card ${grid.card_id}` })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("table")).toHaveLength(2));
    // Rank pipes (data-segment) exist only in the ranking card's table.
    expect(screen.getByTestId(`card:${ranked.card_id}`).querySelector("[data-segment]")).not.toBeNull();
    expect(screen.getByTestId(`card:${grid.card_id}`).querySelector("[data-segment]")).toBeNull();
  });

  it("shows nothing and requests nothing without a context", () => {
    const f = stubCardApi({ payloads: [PAYLOADS.distributionStandalone()] });
    renderWithProviders(<CardsPage />, { route: "/" });
    expect(screen.queryByRole("heading")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("says so when the engine has no cards", async () => {
    stubCardApi({ payloads: [] });
    renderWithProviders(<CardsPage />, { route: `/${CONTEXT_QUERY}` });
    expect(await screen.findByText(/No cards are available/)).toBeInTheDocument();
  });
});
