import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardConfigJson } from "../api/types";
import { _dropWorkspaceMemory, workspaceStore } from "../canvas/workspaceStore";
import { _dropMemory, cardStore } from "../configure/cardStore";
import { CONTEXT_QUERY, PAYLOADS, RANKED, RELATIONSHIP, seedStoredCards, stubCardApi } from "../test/cardApi";
import { renderWithProviders } from "../test/render";
import { CardsPage } from "./CardsPage";

const STATE = "Uttar Pradesh";
const MINE: CardConfigJson = { id: "x", family: "distribution", title: "Mine", scenarios: ["vs_voting_intention"] };

beforeEach(() => {
  localStorage.clear();
  _dropMemory();
  _dropWorkspaceMemory();
});
afterEach(() => vi.unstubAllGlobals());

/** The card's cell on the canvas: the element that holds the card body and the menu beside it. */
const cellOf = (cardTestId: string) => screen.getByTestId(cardTestId).closest("[data-card-body]")!.parentElement as HTMLElement;

describe("CardsPage", () => {
  it("renders one card per card on the canvas", async () => {
    const payloads = [PAYLOADS.distributionStandalone(), PAYLOADS.opinionStandalone(), PAYLOADS.genderStandalone()];
    stubCardApi({ payloads });
    seedStoredCards(STATE, payloads);
    renderWithProviders(<CardsPage />, { route: `/${CONTEXT_QUERY}` });
    for (const p of payloads) expect(await screen.findByRole("heading", { name: `Card ${p.card_id}` })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("table")).toHaveLength(3));
  });

  it("routes ranking families to the ranking card and grid families to the grid card", async () => {
    const grid = PAYLOADS.distributionStandalone();
    const ranked = RANKED.seatTrend();
    stubCardApi({ payloads: [grid, ranked] });
    const [gridCard, rankedCard] = seedStoredCards(STATE, [grid, ranked]);
    renderWithProviders(<CardsPage />, { route: `/${CONTEXT_QUERY}` });
    expect(await screen.findByRole("heading", { name: `Card ${ranked.card_id}` })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: `Card ${grid.card_id}` })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("table")).toHaveLength(2));
    // Rank badges (data-rank) exist only in the ranking card's table.
    expect(screen.getByTestId(`card:${rankedCard.id}`).querySelector("[data-rank]")).not.toBeNull();
    expect(screen.getByTestId(`card:${gridCard.id}`).querySelector("[data-rank]")).toBeNull();
  });

  it("routes relationship cards to the relationship card", async () => {
    const rel = RELATIONSHIP.transition();
    stubCardApi({ payloads: [rel] });
    seedStoredCards(STATE, [rel]);
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

  it("an empty tab says so and offers Add card", async () => {
    stubCardApi({ payloads: [] });
    renderWithProviders(<CardsPage />, { route: `/${CONTEXT_QUERY}` });
    expect(await screen.findByText(/This tab is empty/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add card" })).toBeInTheDocument();
  });

  it("a library card appears only after it is added from the menu", async () => {
    const lib = PAYLOADS.distributionStandalone();
    stubCardApi({ payloads: [lib] });
    renderWithProviders(<CardsPage />, { route: `/${CONTEXT_QUERY}` });
    expect(await screen.findByText(/This tab is empty/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: `Card ${lib.card_id}` })).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "Add card" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: `Card ${lib.card_id}` }));
    expect(await screen.findByRole("heading", { name: `Card ${lib.card_id}` })).toBeInTheDocument();
  });

  it("cards stored before tabs existed appear in Tab 1", async () => {
    stubCardApi({ payloads: [PAYLOADS.distributionStandalone()] });
    const old = cardStore.add(STATE, MINE); // written by the card store alone, as before tabs
    renderWithProviders(<CardsPage />, { route: `/${CONTEXT_QUERY}` });
    expect(await screen.findByTestId(`card:${old.id}`)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows only the active tab's cards", async () => {
    stubCardApi({ payloads: [PAYLOADS.distributionStandalone()] });
    const first = workspaceStore.addCard(STATE, { ...MINE, title: "First" });
    const tab2 = workspaceStore.addTab(STATE);
    workspaceStore.addCard(STATE, { ...MINE, title: "Second" }, tab2.id);
    renderWithProviders(<CardsPage />, { route: `/${CONTEXT_QUERY}` });
    expect(await screen.findByRole("heading", { name: "Second" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "First" })).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Tab 1" }));
    expect(await screen.findByRole("heading", { name: "First" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Second" })).toBeNull();
    expect(screen.getByTestId(`card:${first.id}`)).toBeInTheDocument();
  });

  it("another state's cards never appear in this state's workspace", async () => {
    stubCardApi({ payloads: [PAYLOADS.distributionStandalone()] });
    workspaceStore.addCard("Bihar", { ...MINE, title: "Bihar card" });
    renderWithProviders(<CardsPage />, { route: `/${CONTEXT_QUERY}` });
    expect(await screen.findByText(/This tab is empty/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Bihar card" })).toBeNull();
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
  const act = async (cardTestId: string, item: string) => {
    await userEvent.click(within(cellOf(cardTestId)).getByRole("button", { name: "Card actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: item }));
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
    // The new card is on the active tab's canvas.
    expect(workspaceStore.get(STATE).tabs[0].items.map((i) => i.cardId)).toEqual([stored.id]);
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
    const stored = workspaceStore.addCard(STATE, MINE);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const id = `card:${stored.id}`;
    await screen.findByTestId(id);
    await act(id, "Copy config");
    expect(writeText).toHaveBeenCalledWith(`- ${JSON.stringify(stored.config)}`);
    await act(id, "Copy card");
    await waitFor(() => expect(cardStore.list(STATE)).toHaveLength(2));
    expect(cardStore.list(STATE)[1].config.title).toBe("Mine (copy)");
    await act(id, "Remove");
    await waitFor(() => expect(cardStore.list(STATE).map((c) => c.id)).not.toContain(stored.id));
  });

  it("Configure edits the stored card in place", async () => {
    mount();
    const stored = workspaceStore.addCard(STATE, MINE);
    const id = `card:${stored.id}`;
    await screen.findByTestId(id);
    await act(id, "Configure");
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
