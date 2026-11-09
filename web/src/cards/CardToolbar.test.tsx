import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { CardToolbar, type View } from "./CardToolbar";

describe("CardToolbar View/Lenses chip", () => {
  it("renders lens popover when template offers multiple lenses and calls onView with selected lens", async () => {
    const onView = vi.fn();
    const view: View = {
      preset: "both", density: "standard", transposed: false,
      format: "none", within: "column", sort: null, lens: "support_share"
    };
    render(
      <MantineProvider>
        <CardToolbar
          view={view} onView={onView} initial={view} canSort={false} columns={[]}
          onMethod={vi.fn()} onExport={vi.fn()} canExport={true} onRefresh={vi.fn()}
          availableLenses={["support_share", "contribution_share", "size_of_impact_pp"]}
        />
      </MantineProvider>
    );

    const chip = screen.getByText(/Lens: Support %/i);
    expect(chip).toBeInTheDocument();
    await userEvent.click(chip);
    const option = screen.getByText(/Contribution %/i);
    await userEvent.click(option);
    expect(onView).toHaveBeenCalledWith({ lens: "contribution_share" });
  });

  it("does not render lens popover when availableLenses has fewer than 2 lenses", () => {
    const onView = vi.fn();
    const view: View = {
      preset: "both", density: "standard", transposed: false,
      format: "none", within: "column", sort: null, lens: "support_share"
    };
    render(
      <MantineProvider>
        <CardToolbar
          view={view} onView={onView} initial={view} canSort={false} columns={[]}
          onMethod={vi.fn()} onExport={vi.fn()} canExport={true} onRefresh={vi.fn()}
          availableLenses={["support_share"]}
        />
      </MantineProvider>
    );
    expect(screen.queryByText(/Lens:/i)).not.toBeInTheDocument();
  });

  it("does not render lens popover when availableLenses is undefined", () => {
    const onView = vi.fn();
    const view: View = {
      preset: "both", density: "standard", transposed: false,
      format: "none", within: "column", sort: null, lens: "support_share"
    };
    render(
      <MantineProvider>
        <CardToolbar
          view={view} onView={onView} initial={view} canSort={false} columns={[]}
          onMethod={vi.fn()} onExport={vi.fn()} canExport={true} onRefresh={vi.fn()}
        />
      </MantineProvider>
    );
    expect(screen.queryByText(/Lens:/i)).not.toBeInTheDocument();
  });

  it("displays human-readable label for custom lens and net impact", () => {
    const onView = vi.fn();
    const view: View = {
      preset: "both", density: "standard", transposed: false,
      format: "none", within: "column", sort: null, lens: "size_of_impact_pp"
    };
    render(
      <MantineProvider>
        <CardToolbar
          view={view} onView={onView} initial={view} canSort={false} columns={[]}
          onMethod={vi.fn()} onExport={vi.fn()} canExport={true} onRefresh={vi.fn()}
          availableLenses={["support_share", "size_of_impact_pp"]}
        />
      </MantineProvider>
    );
    expect(screen.getByText(/Lens: Net Impact \(pp\)/i)).toBeInTheDocument();
  });
});
