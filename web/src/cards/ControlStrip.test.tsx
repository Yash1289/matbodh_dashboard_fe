import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GridPayload } from "../api/types";
import compareFixture from "../test/fixtures/cards/distribution_compare.json";
import standaloneFixture from "../test/fixtures/cards/distribution_standalone.json";
import genderFixture from "../test/fixtures/cards/gender_differential_standalone.json";
import { renderWithProviders } from "../test/render";
import { ControlStrip, lensPresentation } from "./ControlStrip";
import type { SizeClass } from "./sizeClass";
import { cutLabel, initialView, type FamilyView } from "./view";

const load = (fixture: unknown): GridPayload => structuredClone(fixture) as GridPayload;

function mount(payload: GridPayload, over: Partial<FamilyView> = {}, size: SizeClass = "wide") {
  const onView = vi.fn();
  const view = { ...initialView(payload), ...over };
  renderWithProviders(
    <ControlStrip payload={payload} view={view} onView={onView} onMethod={vi.fn()}
      onExport={vi.fn()} canExport onRefresh={vi.fn()} size={size} />,
  );
  return onView;
}

afterEach(() => vi.restoreAllMocks());

describe("ControlStrip lenses", () => {
  it("lists the lenses from the payload meta in the lens chip", async () => {
    const p = load(standaloneFixture);
    mount(p);
    await userEvent.click(screen.getByText(/Lens: Support %/));
    for (const lens of p.meta.lenses) expect(screen.getAllByText(lens.label).length).toBeGreaterThan(0);
  });

  it("hides the lens chip when only one lens has data", () => {
    const p = load(standaloneFixture);
    p.meta.lenses = p.meta.lenses.slice(0, 1);
    mount(p);
    expect(screen.queryByText(/Lens:/)).not.toBeInTheDocument();
  });

  it("changing the lens reports only the lens", async () => {
    const onView = mount(load(standaloneFixture));
    await userEvent.click(screen.getByText(/Lens: Support %/));
    await userEvent.click(screen.getByText("Contribution %"));
    expect(onView).toHaveBeenCalledWith({ lens: "contribution_share" });
  });
});

describe("ControlStrip capabilities", () => {
  it("gives gender differential no delta controls", async () => {
    const p = load(genderFixture);
    mount(p);
    expect(screen.queryByText(/Cell:/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText(/Sort/));
    expect(document.body.textContent).not.toContain("Δ");
  });

  it("omits the transpose chip when the family cannot transpose", () => {
    const p = load(standaloneFixture);
    p.meta.capabilities.transpose = false;
    mount(p);
    expect(screen.queryByText(/Transpose/)).not.toBeInTheDocument();
  });

  it("offers Δ controls only in compare mode", async () => {
    mount(load(compareFixture));
    await userEvent.click(screen.getByRole("button", { name: /^View/ }));
    expect(await screen.findByText("Cell parts")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByText(/Sort/));
    expect(screen.getAllByText(/Δ .* high to low/).length).toBeGreaterThan(0);
  });

  it("shows cut tabs when there is more than one cut and selects one", async () => {
    const p = load(standaloneFixture);
    const onView = mount(p);
    const second = p.cuts[1];
    await userEvent.click(screen.getByText(cutLabel(second.dimensions)));
    expect(onView).toHaveBeenCalledWith({ cut: second.id });
  });

  it("omits the cut tabs for a single cut", () => {
    const p = load(standaloneFixture);
    p.cuts = p.cuts.slice(0, 1);
    mount(p);
    expect(screen.queryByRole("radiogroup", { name: "Cut" })).not.toBeInTheDocument();
  });
});

describe("ControlStrip layout and access", () => {
  it("keeps Density inside the View menu when narrow", async () => {
    mount(load(standaloneFixture), {}, "narrow");
    expect(screen.queryByText(/Density/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^View/ }));
    expect(await screen.findByText(/Density/)).toBeInTheDocument();
  });

  it("opens a popover chip with Enter and closes it with Escape", async () => {
    mount(load(standaloneFixture));
    const chip = screen.getByText(/Lens: Support %/);
    chip.focus();
    await userEvent.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    expect(screen.getByText("Contribution %")).toBeInTheDocument();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Contribution %")).not.toBeInTheDocument());
    await waitFor(() => expect(chip).toHaveFocus());
  });

  it("never makes a network request when a control changes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount(load(standaloneFixture));
    await userEvent.click(screen.getByText(/Lens: Support %/));
    await userEvent.click(screen.getByText("Contribution %"));
    await userEvent.click(screen.getByText(/Transpose/));
    await userEvent.click(screen.getByRole("button", { name: /^View/ }));
    await userEvent.click(await screen.findByText(/Details/));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("offers the method, export and refresh actions in the View menu", async () => {
    mount(load(standaloneFixture));
    await userEvent.click(screen.getByRole("button", { name: /^View/ }));
    const menu = await screen.findByRole("dialog");
    expect(within(menu).getByText("How this was calculated")).toBeInTheDocument();
    expect(within(menu).getByText("Export CSV")).toBeInTheDocument();
    expect(within(menu).getByText("Refresh")).toBeInTheDocument();
  });
});

describe("lens presentation", () => {
  it("is tabs only for a wide card with three lenses or fewer", () => {
    expect(lensPresentation(3, "wide")).toBe("tabs");
    expect(lensPresentation(2, "wide")).toBe("tabs");
    expect(lensPresentation(4, "wide")).toBe("chip");
    expect(lensPresentation(3, "medium")).toBe("chip");
    expect(lensPresentation(3, "narrow")).toBe("chip");
    expect(lensPresentation(1, "wide")).toBe("none");
  });

  it("draws three lenses as tabs on a wide card and selects one", async () => {
    const p = load(standaloneFixture);
    p.meta.lenses = p.meta.lenses.slice(0, 3);
    const onView = mount(p, {}, "wide");
    const tabs = screen.getByRole("tablist", { name: "Lens" });
    expect(within(tabs).getAllByRole("tab")).toHaveLength(3);
    expect(within(tabs).getByRole("tab", { selected: true })).toHaveTextContent(p.meta.lenses[0].label);
    await userEvent.click(within(tabs).getByRole("tab", { name: p.meta.lenses[1].label }));
    expect(onView).toHaveBeenCalledWith({ lens: p.meta.lenses[1].id });
  });

  it("draws the same three lenses as a chip on a narrow card", () => {
    const p = load(standaloneFixture);
    p.meta.lenses = p.meta.lenses.slice(0, 3);
    mount(p, {}, "narrow");
    expect(screen.queryByRole("tablist", { name: "Lens" })).not.toBeInTheDocument();
    expect(screen.getByText(/Lens: Support %/)).toBeInTheDocument();
  });
});

describe("changed-from-default state", () => {
  it("shows a plain chip at the default and a marked one when changed", () => {
    const p = load(standaloneFixture);
    mount(p);
    expect(screen.getByText(/Lens: Support %/)).not.toHaveAttribute("data-changed");
  });

  it("marks the chip as changed once the view differs from its default", () => {
    const p = load(standaloneFixture);
    mount(p, { lens: "contribution_share" });
    expect(screen.getByText(/Lens: Contribution %/)).toHaveAttribute("data-changed", "true");
  });
});

describe("View menu", () => {
  it("shows each setting's current value and how many are changed", async () => {
    const p = load(standaloneFixture);
    mount(p, { density: "compact" }, "medium");
    const view = screen.getByRole("button", { name: /^View/ });
    expect(within(view).getByText("1")).toBeInTheDocument();
    await userEvent.click(view);
    const menu = await screen.findByRole("dialog");
    expect(within(menu).getByTestId("view-row-density")).toHaveTextContent("Compact");
    expect(within(menu).getByTestId("view-row-format")).toHaveTextContent("None");
  });

  it("moves Format into the View menu below the wide size", async () => {
    mount(load(standaloneFixture), {}, "wide");
    expect(screen.getByText(/Format/)).toBeInTheDocument();
    expect(screen.queryByTestId("view-row-format")).not.toBeInTheDocument();
  });
});
