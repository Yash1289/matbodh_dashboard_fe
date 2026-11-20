import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { ViewMenu } from "./ViewMenu";

describe("ViewMenu", () => {
  it("runs an action and closes itself, so the thing the action opens is not left under an open menu", async () => {
    const onSelect = vi.fn();
    renderWithProviders(<ViewMenu rows={[]} actions={[{ id: "method", label: "How this was calculated", onSelect }]} />);
    await userEvent.click(screen.getByRole("button", { name: /^View/ }));
    const menu = await screen.findByRole("dialog");
    await userEvent.click(within(menu).getByRole("button", { name: "How this was calculated" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("stays open while a setting is edited", async () => {
    renderWithProviders(<ViewMenu rows={[{ id: "details", label: "Details", value: "Off", selected: false, toggle: { pressed: false, onToggle: vi.fn() } }]} actions={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /^View/ }));
    await userEvent.click(await screen.findByText("Details"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
