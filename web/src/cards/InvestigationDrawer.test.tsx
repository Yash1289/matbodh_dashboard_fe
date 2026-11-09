import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { InvestigationDrawer, type SeatCohort } from "./InvestigationDrawer";

describe("InvestigationDrawer", () => {
  const mockCohort: SeatCohort = {
    title: "67 Gained Seats",
    subtitle: "Seats won in 2027 VS R2 that were lost in R1",
    totalSeats: 67,
    avgMarginPp: 4.2,
    voteShare: 43.8,
    demographicDrivers: [
      { label: "Jatav", share: 38.5 },
      { label: "Other OBC", share: 52.1 },
    ],
    seats: [
      { ac_num: 12, name: "Meerut Cantt", winner: "NDA", margin_pp: 5.4, flip: "gain" },
      { ac_num: 34, name: "Aligarh City", winner: "NDA", margin_pp: 2.1, flip: "gain" },
    ],
  };

  it("renders drawer header, KPIs, demographic drivers, and seat roster when opened", () => {
    render(
      <MantineProvider>
        <InvestigationDrawer opened={true} onClose={vi.fn()} cohort={mockCohort} />
      </MantineProvider>
    );

    expect(screen.getByText("Investigating: 67 Gained Seats")).toBeInTheDocument();
    expect(screen.getByText("Seats won in 2027 VS R2 that were lost in R1")).toBeInTheDocument();
    expect(screen.getByText("Meerut Cantt")).toBeInTheDocument();
    expect(screen.getByText("Aligarh City")).toBeInTheDocument();
    expect(screen.getByText("Jatav")).toBeInTheDocument();
    expect(screen.getByText("67")).toBeInTheDocument();
    expect(screen.getByText("+4.2 pp")).toBeInTheDocument();
  });

  it("invokes onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <MantineProvider>
        <InvestigationDrawer opened={true} onClose={onClose} cohort={mockCohort} />
      </MantineProvider>
    );

    const closeBtn = screen.getByRole("button", { name: /close drawer/i });
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("filters seat roster in real-time when typing in search input", async () => {
    render(
      <MantineProvider>
        <InvestigationDrawer opened={true} onClose={vi.fn()} cohort={mockCohort} />
      </MantineProvider>
    );

    const searchInput = screen.getByPlaceholderText(/Search seats/i);
    await userEvent.type(searchInput, "Meerut");
    expect(screen.getByText("Meerut Cantt")).toBeInTheDocument();
    expect(screen.queryByText("Aligarh City")).not.toBeInTheDocument();
  });

  it("filters seat roster by AC number", async () => {
    render(
      <MantineProvider>
        <InvestigationDrawer opened={true} onClose={vi.fn()} cohort={mockCohort} />
      </MantineProvider>
    );

    const searchInput = screen.getByPlaceholderText(/Search seats/i);
    await userEvent.type(searchInput, "34");
    expect(screen.getByText("Aligarh City")).toBeInTheDocument();
    expect(screen.queryByText("Meerut Cantt")).not.toBeInTheDocument();
  });

  it("handles copy seat list to clipboard", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(
      <MantineProvider>
        <InvestigationDrawer opened={true} onClose={vi.fn()} cohort={mockCohort} />
      </MantineProvider>
    );

    const copyBtn = screen.getByRole("button", { name: /copy seat list/i });
    await userEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalled();
    const copiedText = writeTextMock.mock.calls[0][0];
    expect(copiedText).toContain("Meerut Cantt");
    expect(copiedText).toContain("Aligarh City");
  });

  it("handles export CSV", async () => {
    const createObjectURLMock = vi.fn().mockReturnValue("blob:mock-csv-url");
    const revokeObjectURLMock = vi.fn();
    (globalThis as any).URL.createObjectURL = createObjectURLMock;
    (globalThis as any).URL.revokeObjectURL = revokeObjectURLMock;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(
      <MantineProvider>
        <InvestigationDrawer opened={true} onClose={vi.fn()} cohort={mockCohort} />
      </MantineProvider>
    );

    const exportBtn = screen.getByRole("button", { name: /export csv/i });
    await userEvent.click(exportBtn);
    expect(createObjectURLMock).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("handles empty or null cohort gracefully", () => {
    render(
      <MantineProvider>
        <InvestigationDrawer opened={true} onClose={vi.fn()} cohort={null} />
      </MantineProvider>
    );

    expect(screen.getByText(/no cohort selected/i)).toBeInTheDocument();
  });
});
