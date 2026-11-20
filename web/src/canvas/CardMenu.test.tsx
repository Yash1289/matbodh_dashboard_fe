import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardConfigJson } from "../api/types";
import { _dropMemory, cardStore, copyConfigText } from "../configure/cardStore";
import { renderWithProviders } from "../test/render";
import { CardMenu } from "./CardMenu";
import { _dropWorkspaceMemory, useWorkspace, workspaceStore } from "./workspaceStore";

const STATE = "Uttar Pradesh";
const CONFIG: CardConfigJson = { id: "x", family: "distribution", title: "Vote", scenarios: ["vs_voting_intention"], cuts: [[]] };

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  _dropMemory();
  _dropWorkspaceMemory();
});

function Harness({ cardId, onConfigure, rows = 7 }: { cardId: string; onConfigure(id: string): void; rows?: number }) {
  const ws = useWorkspace(STATE);
  const tab = ws.tabs.find((t) => t.items.some((i) => i.cardId === cardId)) ?? ws.tabs[0];
  return <CardMenu state={STATE} tab={tab} tabs={ws.tabs} cardId={cardId} onConfigure={onConfigure} measureRows={() => rows} />;
}

const item = (id: string) => workspaceStore.get(STATE).tabs.flatMap((t) => t.items).find((i) => i.cardId === id)!;
const open = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Card actions" }));
const choose = async (user: ReturnType<typeof userEvent.setup>, name: RegExp | string) => {
  await open(user);
  await user.click(await screen.findByRole("menuitem", { name }));
};

describe("CardMenu", () => {
  it("every action is a menu item reachable with the keyboard", async () => {
    const user = userEvent.setup();
    const card = workspaceStore.addCard(STATE, CONFIG);
    const onConfigure = vi.fn();
    renderWithProviders(<Harness cardId={card.id} onConfigure={onConfigure} />);
    screen.getByRole("button", { name: "Card actions" }).focus();
    await user.keyboard("{Enter}");
    const names = (await screen.findAllByRole("menuitem")).map((m) => m.textContent);
    for (const expected of [/Configure/, /Copy card/, /Copy config/, /Move left/, /Move right/, /Move up/, /Move down/, /Size: Small/, /Size: Medium/, /Size: Wide/, /Size: Full/, /Fit to content/, /Remove/]) {
      expect(names.some((n) => expected.test(n ?? ""))).toBe(true);
    }
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onConfigure).toHaveBeenCalledWith(card.id);
  });

  it("Move right changes the stored column by one and announces the new place", async () => {
    const user = userEvent.setup();
    const card = workspaceStore.addCard(STATE, CONFIG);
    renderWithProviders(<Harness cardId={card.id} onConfigure={() => {}} />);
    await choose(user, "Move right");
    expect(item(card.id).x).toBe(1);
    expect(screen.getByRole("status")).toHaveTextContent("Moved to column 2, row 1");
  });

  it("Move left at the edge changes nothing and says so", async () => {
    const user = userEvent.setup();
    const card = workspaceStore.addCard(STATE, CONFIG);
    renderWithProviders(<Harness cardId={card.id} onConfigure={() => {}} />);
    await choose(user, "Move left");
    expect(item(card.id).x).toBe(0);
    expect(screen.getByRole("status")).toHaveTextContent(/cannot move left any further/i);
  });

  it("Size Small stores a 4-column width and announces it", async () => {
    const user = userEvent.setup();
    const card = workspaceStore.addCard(STATE, CONFIG);
    renderWithProviders(<Harness cardId={card.id} onConfigure={() => {}} />);
    await choose(user, /Size: Small/);
    expect(item(card.id).w).toBe(4);
    expect(screen.getByRole("status")).toHaveTextContent("Size set to Small, 4 columns");
  });

  it("Fit to content stores the height the page measured", async () => {
    const user = userEvent.setup();
    const card = workspaceStore.addCard(STATE, CONFIG);
    renderWithProviders(<Harness cardId={card.id} onConfigure={() => {}} rows={13} />);
    await choose(user, "Fit to content");
    expect(item(card.id).h).toBe(13);
    expect(screen.getByRole("status")).toHaveTextContent("Height set to 13 rows");
  });

  it("Copy card adds a second card directly under the original", async () => {
    const user = userEvent.setup();
    const card = workspaceStore.addCard(STATE, CONFIG);
    renderWithProviders(<Harness cardId={card.id} onConfigure={() => {}} />);
    await choose(user, "Copy card");
    const items = workspaceStore.get(STATE).tabs[0].items;
    expect(items).toHaveLength(2);
    const original = item(card.id);
    expect(items.find((i) => i.cardId !== card.id)!.y).toBeGreaterThanOrEqual(original.y + original.h);
  });

  it("Move to tab moves the card, and the menu does not offer the tab the card is in", async () => {
    const user = userEvent.setup();
    const card = workspaceStore.addCard(STATE, CONFIG);
    const second = workspaceStore.addTab(STATE);
    renderWithProviders(<Harness cardId={card.id} onConfigure={() => {}} />);
    await open(user);
    expect(screen.queryByRole("menuitem", { name: "Move to tab: Tab 1" })).toBeNull();
    await user.click(await screen.findByRole("menuitem", { name: "Move to tab: Tab 2" }));
    expect(workspaceStore.get(STATE).tabs.find((t) => t.id === second.id)!.items.map((i) => i.cardId)).toEqual([card.id]);
  });

  it("offers no Move to tab with a single tab", async () => {
    const user = userEvent.setup();
    const card = workspaceStore.addCard(STATE, CONFIG);
    renderWithProviders(<Harness cardId={card.id} onConfigure={() => {}} />);
    await open(user);
    await screen.findByRole("menuitem", { name: "Remove" });
    expect(screen.queryByRole("menuitem", { name: /Move to tab/ })).toBeNull();
  });

  it("Remove removes the card", async () => {
    const user = userEvent.setup();
    const card = workspaceStore.addCard(STATE, CONFIG);
    renderWithProviders(<Harness cardId={card.id} onConfigure={() => {}} />);
    await choose(user, "Remove");
    expect(cardStore.list(STATE)).toEqual([]);
  });

  it("Copy config writes the YAML list item to the clipboard", async () => {
    const user = userEvent.setup();
    const card = workspaceStore.addCard(STATE, CONFIG);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderWithProviders(<Harness cardId={card.id} onConfigure={() => {}} />);
    await choose(user, "Copy config");
    expect(writeText).toHaveBeenCalledWith(copyConfigText(cardStore.list(STATE)[0].config));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Config copied"));
  });

  it("a blocked clipboard does not break the page", async () => {
    const user = userEvent.setup();
    const card = workspaceStore.addCard(STATE, CONFIG);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: () => Promise.reject(new Error("blocked")) } });
    renderWithProviders(<Harness cardId={card.id} onConfigure={() => {}} />);
    await choose(user, "Copy config");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/could not copy/i));
  });
});
