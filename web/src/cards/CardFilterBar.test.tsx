import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { CardFilterBar } from "./CardFilterBar";

describe("CardFilterBar", () => {
  it("renders promoted slicer chip and triggers onSlicerChange", async () => {
    const onSlicerChange = vi.fn();
    render(
      <MantineProvider>
        <CardFilterBar
          slicers={[{
            dimension: "party_zone",
            label: "Zone",
            options: ["All Zones", "Jat Belt", "Purvanchal", "Awadh"],
            selected: "All Zones"
          }]}
          onSlicerChange={onSlicerChange}
        />
      </MantineProvider>
    );

    const chip = screen.getByText(/Zone: All Zones/i);
    expect(chip).toBeInTheDocument();
    await userEvent.click(chip);
    const option = screen.getByText("Jat Belt");
    await userEvent.click(option);
    expect(onSlicerChange).toHaveBeenCalledWith("party_zone", "Jat Belt");
  });

  it("renders multiple slicers and handles changes independently", async () => {
    const onSlicerChange = vi.fn();
    render(
      <MantineProvider>
        <CardFilterBar
          slicers={[
            {
              dimension: "party_zone",
              label: "Zone",
              options: ["All Zones", "Jat Belt"],
              selected: "Jat Belt"
            },
            {
              dimension: "category",
              label: "Category",
              options: ["All Categories", "GEN", "OBC", "SC"],
              selected: "All Categories"
            }
          ]}
          onSlicerChange={onSlicerChange}
        />
      </MantineProvider>
    );

    expect(screen.getByText(/Zone: Jat Belt/i)).toBeInTheDocument();
    const catChip = screen.getByText(/Category: All Categories/i);
    expect(catChip).toBeInTheDocument();

    await userEvent.click(catChip);
    const obcOption = screen.getByText("OBC");
    await userEvent.click(obcOption);
    expect(onSlicerChange).toHaveBeenCalledWith("category", "OBC");
  });

  it("renders seat-attribute filters and triggers onFilterChange", async () => {
    const onFilterChange = vi.fn();
    render(
      <MantineProvider>
        <CardFilterBar
          filters={[{
            id: "reservation",
            label: "Reservation",
            options: ["All", "GEN", "SC", "ST"],
            selected: "All"
          }]}
          onFilterChange={onFilterChange}
        />
      </MantineProvider>
    );

    const chip = screen.getByText(/Reservation: All/i);
    expect(chip).toBeInTheDocument();
    await userEvent.click(chip);
    const scOption = screen.getByText("SC");
    await userEvent.click(scOption);
    expect(onFilterChange).toHaveBeenCalledWith("reservation", "SC");
  });

  it("returns null or empty when no slicers or filters are provided", () => {
    const { container } = render(
      <MantineProvider>
        <CardFilterBar slicers={[]} filters={[]} />
      </MantineProvider>
    );
    expect(container.querySelector(".mantine-Group-root")).toBeNull();
  });
});
