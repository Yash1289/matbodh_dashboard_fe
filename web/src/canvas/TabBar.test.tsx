import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { CardConfigJson } from "../api/types";
import { _dropMemory } from "../configure/cardStore";
import { renderWithProviders } from "../test/render";
import { TabBar } from "./TabBar";
import { _dropWorkspaceMemory, useWorkspace, workspaceStore } from "./workspaceStore";

const STATE = "Uttar Pradesh";
const CONFIG: CardConfigJson = { id: "x", family: "distribution", title: "Vote", scenarios: ["vs_voting_intention"], cuts: [[]] };

afterEach(() => {
  localStorage.clear();
  _dropMemory();
  _dropWorkspaceMemory();
});

function Harness() {
  const workspace = useWorkspace(STATE);
  return <TabBar state={STATE} workspace={workspace} />;
}

const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent);
const openMenu = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: /Tab actions/ }));

describe("TabBar", () => {
  it("shows the tabs and marks the active one", () => {
    workspaceStore.addTab(STATE);
    renderWithProviders(<Harness />);
    expect(tabNames()).toEqual(["Tab 1", "Tab 2"]);
    expect(screen.getByRole("tab", { name: "Tab 2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveAttribute("aria-selected", "false");
  });

  it("New tab adds a tab and makes it active", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole("button", { name: "New tab" }));
    expect(tabNames()).toEqual(["Tab 1", "Tab 2"]);
    expect(screen.getByRole("tab", { name: "Tab 2" })).toHaveAttribute("aria-selected", "true");
  });

  it("clicking a tab makes it active, and arrow keys move between tabs", async () => {
    const user = userEvent.setup();
    workspaceStore.addTab(STATE);
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole("tab", { name: "Tab 1" }));
    expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Tab 2" })).toHaveAttribute("aria-selected", "true");
  });

  it("Rename edits the name in place: Enter saves", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByRole("textbox", { name: "Tab name" });
    await user.clear(input);
    await user.type(input, "Zones{Enter}");
    expect(tabNames()).toEqual(["Zones"]);
  });

  it("Escape cancels a rename", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByRole("textbox", { name: "Tab name" });
    await user.clear(input);
    await user.type(input, "Zones{Escape}");
    expect(tabNames()).toEqual(["Tab 1"]);
  });

  it("Move right changes the order", async () => {
    const user = userEvent.setup();
    workspaceStore.addTab(STATE);
    workspaceStore.setActiveTab(STATE, workspaceStore.get(STATE).tabs[0].id);
    renderWithProviders(<Harness />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Move right" }));
    expect(tabNames()).toEqual(["Tab 2", "Tab 1"]);
  });

  it("Move left is disabled on the first tab", async () => {
    const user = userEvent.setup();
    workspaceStore.addTab(STATE);
    workspaceStore.setActiveTab(STATE, workspaceStore.get(STATE).tabs[0].id);
    renderWithProviders(<Harness />);
    await openMenu(user);
    expect(await screen.findByRole("menuitem", { name: "Move left" })).toBeDisabled();
  });

  it("Delete on an empty tab removes it without asking", async () => {
    const user = userEvent.setup();
    workspaceStore.addTab(STATE);
    renderWithProviders(<Harness />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tabNames()).toEqual(["Tab 1"]);
  });

  it("Delete on a tab with cards asks first, names the count, and Cancel keeps the tab", async () => {
    const user = userEvent.setup();
    workspaceStore.addCard(STATE, CONFIG);
    workspaceStore.addCard(STATE, CONFIG);
    workspaceStore.addTab(STATE);
    workspaceStore.setActiveTab(STATE, workspaceStore.get(STATE).tabs[0].id);
    renderWithProviders(<Harness />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/2 cards/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(tabNames()).toEqual(["Tab 1", "Tab 2"]);
  });

  it("confirming the delete removes the tab and its cards", async () => {
    const user = userEvent.setup();
    workspaceStore.addCard(STATE, CONFIG);
    workspaceStore.addTab(STATE);
    workspaceStore.setActiveTab(STATE, workspaceStore.get(STATE).tabs[0].id);
    renderWithProviders(<Harness />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/1 card\b/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete tab" }));
    expect(tabNames()).toEqual(["Tab 2"]);
  });

  it("Delete is disabled on the last tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await openMenu(user);
    expect(await screen.findByRole("menuitem", { name: "Delete" })).toBeDisabled();
  });
});
