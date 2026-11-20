import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { TableChooser } from "./TableChooser";

const options = [
  { value: "summary", label: "Summary" }, { value: "comparison", label: "Comparison" },
  { value: "margin_buckets", label: "Margin buckets" }, { value: "flips", label: "Seat flips" },
];

const show = (size: "narrow" | "medium" | "wide", value = "summary") => {
  const onChange = vi.fn();
  renderWithProviders(<TableChooser label="Table" value={value} options={options} onChange={onChange} size={size} />);
  return onChange;
};

describe("TableChooser", () => {
  it("is a row of tabs on a wide card, with the current table selected", async () => {
    const onChange = show("wide", "comparison");
    const tabs = screen.getByRole("tablist", { name: "Table" });
    expect(within(tabs).getAllByRole("tab")).toHaveLength(4);
    expect(within(tabs).getByRole("tab", { selected: true })).toHaveTextContent("Comparison");
    await userEvent.click(within(tabs).getByRole("tab", { name: "Seat flips" }));
    expect(onChange).toHaveBeenCalledWith("flips");
  });

  it.each(["medium", "narrow"] as const)("is a chip on a %s card, whatever the number of tables", async (size) => {
    const onChange = show(size);
    expect(screen.queryByRole("tablist")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Table: Summary/ }));
    await userEvent.selectOptions(await screen.findByLabelText("Table"), "flips");
    expect(onChange).toHaveBeenCalledWith("flips");
  });
});
