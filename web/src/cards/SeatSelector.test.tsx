import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { SeatSelector } from "./SeatSelector";

const show = (over: Partial<Parameters<typeof SeatSelector>[0]> = {}) => {
  const onChange = vi.fn();
  renderWithProviders(
    <SeatSelector field="party_zone" values={["Bundelkhand", "Doab", "Purvanchal"]} hasAll={false} value="Bundelkhand"
      onChange={onChange} {...over} />,
  );
  return onChange;
};

describe("SeatSelector", () => {
  it("shows the field, the chosen value and its position", () => {
    show({ value: "Doab" });
    expect(screen.getByRole("group", { name: "party zone" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Doab/ })).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("steps to the next and previous value without opening the list", async () => {
    const onChange = show({ value: "Doab" });
    await userEvent.click(screen.getByRole("button", { name: "Next party zone" }));
    expect(onChange).toHaveBeenLastCalledWith("Purvanchal");
    await userEvent.click(screen.getByRole("button", { name: "Previous party zone" }));
    expect(onChange).toHaveBeenLastCalledWith("Bundelkhand");
  });

  it("disables next on the last value and previous on the first when there is no All", () => {
    show({ value: "Purvanchal" });
    expect(screen.getByRole("button", { name: "Next party zone" })).toBeDisabled();
  });

  it("steps between All and the first value when the engine has All", async () => {
    const onChange = show({ hasAll: true, value: null });
    expect(screen.getByText("3 values")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous party zone" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next party zone" }));
    expect(onChange).toHaveBeenLastCalledWith("Bundelkhand");
  });

  it("offers an All option only when the engine has one", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: /Bundelkhand/ }));
    const list = await screen.findByRole("listbox", { name: "party zone" });
    expect(within(list).queryByRole("option", { name: "All" })).not.toBeInTheDocument();
    expect(within(list).getAllByRole("option")).toHaveLength(3);
  });

  it("filters the list by the search text and selects an option", async () => {
    const onChange = show({ hasAll: true, value: null });
    await userEvent.click(screen.getByRole("button", { name: /All/ }));
    await userEvent.type(await screen.findByRole("searchbox", { name: "Find party zone" }), "pur");
    const list = screen.getByRole("listbox", { name: "party zone" });
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    await userEvent.click(within(list).getByRole("option", { name: "Purvanchal" }));
    expect(onChange).toHaveBeenLastCalledWith("Purvanchal");
  });
});
