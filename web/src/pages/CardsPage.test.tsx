import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTEXT_QUERY, PAYLOADS, stubCardApi } from "../test/cardApi";
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
