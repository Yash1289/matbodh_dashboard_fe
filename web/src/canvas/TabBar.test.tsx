import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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

  it("is a vertical list of tabs, with a New tab button that says what it does", () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole("tablist")).toHaveAttribute("aria-orientation", "vertical");
    expect(screen.getByRole("button", { name: "New tab" })).toHaveTextContent("New tab");
  });

  it("choosing a tab tells the host, so a drawer can close", async () => {
    const user = userEvent.setup();
    workspaceStore.addTab(STATE);
    const seen: string[] = [];
    function Host() {
      const workspace = useWorkspace(STATE);
      return <TabBar state={STATE} workspace={workspace} onSelect={() => seen.push("picked")} />;
    }
    renderWithProviders(<Host />);
    await user.click(screen.getByRole("tab", { name: "Tab 1" }));
    expect(seen).toEqual(["picked"]);
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
    await user.keyboard("{ArrowDown}");
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

  it("Move down changes the order", async () => {
    const user = userEvent.setup();
    workspaceStore.addTab(STATE);
    workspaceStore.setActiveTab(STATE, workspaceStore.get(STATE).tabs[0].id);
    renderWithProviders(<Harness />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Move down" }));
    expect(tabNames()).toEqual(["Tab 2", "Tab 1"]);
  });

  it("Move up is disabled on the first tab", async () => {
    const user = userEvent.setup();
    workspaceStore.addTab(STATE);
    workspaceStore.setActiveTab(STATE, workspaceStore.get(STATE).tabs[0].id);
    renderWithProviders(<Harness />);
    await openMenu(user);
    expect(await screen.findByRole("menuitem", { name: "Move up" })).toBeDisabled();
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

  describe("the session cohort", () => {
    const COHORT = { label: "Top 2 AC", open: false };
    function WithCohort({ open = false, onOpen = () => {}, onSelect = () => {} }: { open?: boolean; onOpen?(): void; onSelect?(): void }) {
      const workspace = useWorkspace(STATE);
      return <TabBar state={STATE} workspace={workspace} onSelect={onSelect} cohort={{ ...COHORT, open, onOpen }} />;
    }

    it("is a sub-tab right under the active tab only", () => {
      workspaceStore.addTab(STATE);
      workspaceStore.addTab(STATE);
      workspaceStore.setActiveTab(STATE, workspaceStore.get(STATE).tabs[1].id);
      renderWithProviders(<WithCohort />);
      expect(tabNames()).toEqual(["Tab 1", "Tab 2", "Cohort · Top 2 AC", "Tab 3"]);
    });

    it("opens the cohort when chosen, and is the selected one (not its parent) while open", async () => {
      const user = userEvent.setup();
      function Stateful() {
        const [open, setOpen] = useState(false);
        return <WithCohort open={open} onOpen={() => setOpen(true)} />;
      }
      renderWithProviders(<Stateful />);
      expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveAttribute("aria-selected", "true");
      await user.click(screen.getByRole("tab", { name: /^Cohort/ }));
      expect(screen.getByRole("tab", { name: /^Cohort/ })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tab", { name: "Tab 1" })).toHaveAttribute("aria-selected", "false");
    });

    it("choosing the parent tab again still tells the host (to leave the cohort page)", async () => {
      const user = userEvent.setup();
      const seen: string[] = [];
      renderWithProviders(<WithCohort open onSelect={() => seen.push("picked")} />);
      await user.click(screen.getByRole("tab", { name: "Tab 1" }));
      expect(seen).toEqual(["picked"]);
    });

    it("is absent without a cohort", () => {
      renderWithProviders(<Harness />);
      expect(tabNames()).toEqual(["Tab 1"]);
    });
  });
});
