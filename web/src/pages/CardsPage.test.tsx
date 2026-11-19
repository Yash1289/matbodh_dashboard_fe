import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _dropMemory, cardStore } from "../configure/cardStore";
import { CONTEXT_QUERY, PAYLOADS, RANKED, RELATIONSHIP, stubCardApi } from "../test/cardApi";
import { renderWithProviders } from "../test/render";
import { CardsPage } from "./CardsPage";

const STATE = "Uttar Pradesh";

beforeEach(() => {
  localStorage.clear();
  _dropMemory();
});
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

  it("routes relationship cards to the relationship card", async () => {
    const rel = RELATIONSHIP.transition();
    stubCardApi({ payloads: [rel] });
    renderWithProviders(<CardsPage />, { route: `/${CONTEXT_QUERY}` });
    expect(await screen.findByRole("heading", { name: `Card ${rel.card_id}` })).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: /Flow summary/ })).toBeInTheDocument();
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
    expect(await screen.findByText(/No cards yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add card" })).toBeInTheDocument();
  });
});

describe("CardsPage: the analyst's own cards", () => {
  const mount = () => {
    stubCardApi({ payloads: [PAYLOADS.distributionStandalone()] });
    renderWithProviders(<CardsPage />, { route: `/${CONTEXT_QUERY}` });
  };
  const addPartyCard = async () => {
    await userEvent.click(await screen.findByRole("button", { name: "Add card" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Party vote share/ }));
  };

  it("adds a card of the chosen type and opens configure; nothing is stored until Apply", async () => {
    mount();
    await addPartyCard();
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("heading", { name: "Party vote share" })).toBeInTheDocument();
    expect(cardStore.list(STATE)).toHaveLength(0);
    const apply = await within(dialog).findByRole("button", { name: "Apply" });
    await waitFor(() => expect(apply).toBeEnabled());
    await userEvent.click(apply);
    await waitFor(() => expect(cardStore.list(STATE)).toHaveLength(1));
    const [stored] = cardStore.list(STATE);
    expect(stored.config).toMatchObject({ family: "distribution", title: "Party vote share", id: stored.id });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByTestId(`card:${stored.id}`)).toBeInTheDocument();
  });

  it("cancel stores nothing", async () => {
    mount();
    await addPartyCard();
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(cardStore.list(STATE)).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("library pick stores a copy with a new id", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Add card" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: `Card ${PAYLOADS.distributionStandalone().card_id}` }));
    const [stored] = cardStore.list(STATE);
    expect(stored.id).not.toBe(PAYLOADS.distributionStandalone().card_id);
    expect(stored.config.title).toBe(`Card ${PAYLOADS.distributionStandalone().card_id}`);
    expect(screen.queryByRole("dialog")).toBeNull(); // a copy is placed, not opened
  });

  it("Copy card, Copy config and Remove act on that card", async () => {
    mount();
    const stored = cardStore.add(STATE, { id: "x", family: "distribution", title: "Mine", scenarios: ["vs_voting_intention"] });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const card = await screen.findByTestId(`card:${stored.id}`);
    const actions = within(card.parentElement?.parentElement as HTMLElement);
    await userEvent.click(actions.getByRole("button", { name: "Copy config" }));
    expect(writeText).toHaveBeenCalledWith(`- ${JSON.stringify(stored.config)}`);
    await userEvent.click(actions.getByRole("button", { name: "Copy card" }));
    await waitFor(() => expect(cardStore.list(STATE)).toHaveLength(2));
    expect(cardStore.list(STATE)[1].config.title).toBe("Mine (copy)");
    await userEvent.click(actions.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(cardStore.list(STATE).map((c) => c.id)).not.toContain(stored.id));
  });

  it("Configure edits the stored card in place", async () => {
    mount();
    const stored = cardStore.add(STATE, { id: "x", family: "distribution", title: "Mine", scenarios: ["vs_voting_intention"] });
    const card = await screen.findByTestId(`card:${stored.id}`);
    await userEvent.click(within(card.parentElement?.parentElement as HTMLElement).getByRole("button", { name: "Configure" }));
    const dialog = await screen.findByRole("dialog");
    const title = await within(dialog).findByRole("textbox", { name: "Title" });
    expect(title).toHaveValue("Mine");
    await userEvent.clear(title);
    await userEvent.type(title, "Renamed");
    const apply = within(dialog).getByRole("button", { name: "Apply" });
    await waitFor(() => expect(apply).toBeEnabled());
    await userEvent.click(apply);
    await waitFor(() => expect(cardStore.list(STATE)[0].config.title).toBe("Renamed"));
    expect(cardStore.list(STATE)).toHaveLength(1);
    expect(cardStore.list(STATE)[0].id).toBe(stored.id);
  });
});
