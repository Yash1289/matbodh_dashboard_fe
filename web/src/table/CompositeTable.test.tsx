import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CellPart } from "../api/types";
import { payloadToGrid } from "../cards/grid/payloadToGrid";
import { PAYLOADS } from "../test/cardApi";
import { CompositeTable } from "./CompositeTable";
import type { CellGrid } from "./grid";

const payload = PAYLOADS.distributionCompare();
const baseGrid = (): CellGrid => payloadToGrid(payload, { lens: payload.meta.default_lens, cut: payload.cuts[0].id });
const COLUMN = baseGrid().columns[0];

function show(parts: CellPart[], extra: Partial<Parameters<typeof CompositeTable>[0]> = {}, grid: CellGrid = baseGrid()) {
  return render(<CompositeTable grid={grid} parts={parts} rounds={payload.rounds} rule={{ kind: "none" }} sort={null} onSort={() => {}} {...extra} />);
}
const sortOn = (column: string, dir: "asc" | "desc") => ({ column, part: "value" as const, dir });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const header = () => screen.getByRole("button", { name: new RegExp(`^${escape(COLUMN.label)}`) });

describe("CompositeTable", () => {
  it("a delta comes from the engine, not from subtraction", () => {
    const g = baseGrid();
    g.cells[g.rows[0].key][COLUMN.key] = { cell: { value: 38, delta: -1.5, trend: [], secondary: null, flags: [], base: null }, unit: "pct" };
    const { container } = show(["value", "delta"], {}, g);
    const row = container.querySelector("tbody tr")!;
    expect(row.textContent).toContain("▼1.50%");
    expect(row.textContent).not.toContain("▼2%");
    expect(row.textContent).toContain("38%");
    expect(row.textContent).not.toMatch(/38\.\d/);
  });

  it("the Pop % cell is its value alone in a compare table, with no empty delta beside it", () => {
    const g = baseGrid();
    g.columns = [{ key: "__pop", label: "Pop %", colour: null }, ...g.columns];
    for (const row of g.rows) {
      g.cells[row.key].__pop = { cell: { value: 14.2, delta: null, trend: [], secondary: null, flags: [], base: null }, unit: "pct" };
    }
    const { container } = show(["value", "delta"], {}, g);
    expect(container.querySelector("tbody tr td")!.textContent).toBe("14%");
  });

  it("a missing cell shows a dash with its reason", () => {
    const g = baseGrid();
    g.cells[g.rows[0].key][COLUMN.key] = { cell: null, unit: "pct" };
    show(["value"], {}, g);
    expect(screen.getAllByTitle("—")[0].textContent).toBe("—");
  });

  it("a column header's sort button is at least 24px tall, so it is a reachable target", () => {
    show(["value"]);
    expect(header()).toHaveStyle({ minHeight: "24px" });
  });

  it("clicking a column header cycles desc, asc, none", async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    const { rerender } = show(["value"], { onSort });
    await user.click(header());
    expect(onSort).toHaveBeenLastCalledWith(sortOn(COLUMN.key, "desc"));
    for (const [current, expected] of [["desc", sortOn(COLUMN.key, "asc")], ["asc", null]] as const) {
      rerender(<CompositeTable grid={baseGrid()} parts={["value"]} rounds={payload.rounds} rule={{ kind: "none" }} sort={sortOn(COLUMN.key, current)} onSort={onSort} />);
      await user.click(header());
      expect(onSort).toHaveBeenLastCalledWith(expected);
    }
  });

  it("sortable headers expose aria-sort", () => {
    const expected = [[null, "none"], [sortOn(COLUMN.key, "desc"), "descending"], [sortOn(COLUMN.key, "asc"), "ascending"]] as const;
    for (const [sort, aria] of expected) {
      const { unmount } = show(["value"], { sort });
      expect(header().closest("th")!.getAttribute("aria-sort")).toBe(aria);
      expect(screen.getAllByRole("columnheader")[0].hasAttribute("aria-sort")).toBe(false);
      unmount();
    }
  });

  it("sorts rows from the sort prop and shows no legend text under the table", () => {
    const g = baseGrid();
    const valueOf = (key: string) => g.cells[key][COLUMN.key].cell?.value ?? null;
    const asc = g.rows.map((r) => r.key).filter((k) => valueOf(k) !== null).sort((a, b) => valueOf(a)! - valueOf(b)!);
    const { container } = show(["value"], { sort: sortOn(COLUMN.key, "asc"), rule: { kind: "heat", within: "column" } }, g);
    const first = [...container.querySelectorAll("tbody th")][0].textContent;
    expect(first).toContain(g.rows.find((r) => r.key === asc[0])!.label);
    expect(screen.queryByText(/Heat on value/)).toBeNull();
  });

  it("sits in the table frame and pins every row label", () => {
    const { container } = show(["value"]);
    expect(screen.getByTestId("table-frame")).toContainElement(container.querySelector("table"));
    const labels = [...container.querySelectorAll("tbody th")];
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((th) => th.className.includes("pin"))).toBe(true);
    expect((container.querySelector("thead th") as HTMLElement).className).toContain("pin");
  });

  it("sizes no table text in pixels, so it scales with the card", () => {
    const { container } = show(["value", "delta"], {}, undefined);
    const sized = [...container.querySelectorAll<HTMLElement>("table *")].filter((el) => el.style.fontSize.endsWith("px"));
    expect(sized.map((el) => `${el.tagName}:${el.style.fontSize}`)).toEqual([]);
  });
});
