import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GridPayload } from "../../../api/types";
import { formatValue } from "../../../cells/format";
import compareFixture from "../../../test/fixtures/cards/distribution_compare.json";
import standaloneFixture from "../../../test/fixtures/cards/distribution_standalone.json";
import trendFixture from "../../../test/fixtures/cards/distribution_trend.json";
import { renderWithProviders } from "../../../test/render";
import { initialView, type FamilyView } from "../../view";
import { GridBody } from "./GridBody";

const load = (fixture: unknown): GridPayload => structuredClone(fixture) as GridPayload;

function mount(payload: GridPayload, over: Partial<FamilyView> = {}, props: Partial<Parameters<typeof GridBody>[0]> = {}) {
  const onView = vi.fn();
  const view = { ...initialView(payload), ...over };
  const utils = renderWithProviders(<GridBody payload={payload} view={view} onView={onView} {...props} />);
  return { ...utils, onView };
}

const headerTexts = () => screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");

describe("GridBody modes", () => {
  it("shows pipes and no delta in trend mode", () => {
    const { container } = mount(load(trendFixture));
    expect(container.querySelectorAll("[data-segment]").length).toBeGreaterThan(0);
    expect(container.querySelector("[data-tone]")).toBeNull();
  });

  it("shows the value with its delta and the reference label in compare mode", () => {
    const { container } = mount(load(compareFixture));
    expect(container.querySelectorAll("[data-tone]").length).toBeGreaterThan(0);
    expect(screen.getByText(/Δ vs 2027 VS CAPI R1/)).toBeInTheDocument();
    expect(container.querySelector('[data-tone][title*="Δ vs 2027 VS CAPI R1"]')).not.toBeNull();
    expect(container.querySelector("[data-segment]")).toBeNull();
  });

  it("shows neither pipes nor a delta when standalone", () => {
    const { container } = mount(load(standaloneFixture));
    expect(container.querySelector("[data-segment]")).toBeNull();
    expect(container.querySelector("[data-tone]")).toBeNull();
  });

  it("keeps the value and shows a dash delta with the reason when the reference is missing", () => {
    const p = load(compareFixture);
    for (const delta of p.cuts[0].deltas) {
      if (delta.lens === "support_share") {
        delta.value = null;
        delta.status = "missing_reference";
      }
    }
    const { container } = mount(p);
    expect(screen.getAllByTitle(/No value in the reference/).length).toBeGreaterThan(0);
    expect(container.textContent).toMatch(/\d+%/);
  });
});

describe("GridBody display controls", () => {
  it("caps the rendered rows at 100 and can show more", async () => {
    const p = load(standaloneFixture);
    const cut = p.cuts[0];
    const column = p.columns[0].key;
    cut.rows = Array.from({ length: 150 }, (_, i) => ({ key: `category=r${i}`, labels: { category: `r${i}` }, subtotal: [] }));
    cut.cells = cut.rows.map((r, i) => ({ row: r.key, column, round: "R2", lens: "support_share", value: i, status: "available" }));
    cut.deltas = [];
    const { container } = mount(p);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(100);
    await userEvent.click(screen.getByRole("button", { name: /Show 100 more/ }));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(150);
  });

  it("keeps the lens and unit when transposed", () => {
    const p = load(standaloneFixture);
    const column = p.columns[0].key;
    const cv = p.cuts[0].cells.find((c) => c.lens === "size_of_impact_pp" && c.column === column && c.row === "overall")!;
    const { container } = mount(p, { transposed: true, lens: "size_of_impact_pp" });
    const first = container.querySelector("tbody tr:first-child td")!;
    expect(first.textContent).toContain(formatValue(cv.value, "pp"));
  });

  it("does not render a hidden column", () => {
    const p = load(standaloneFixture);
    mount(p, { hidden: [p.columns[0].key] });
    expect(screen.queryByRole("columnheader", { name: /SP\+/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: /BSP/ })).toBeInTheDocument();
  });

  it("filters rows by the search text", () => {
    const p = load(standaloneFixture);
    mount(p, { cut: "g1", search: "mus" });
    expect(screen.getByRole("rowheader", { name: /Muslim/ })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: /GEN/ })).toBeNull();
  });

  it("scales a heat format within the table", () => {
    const { container } = mount(load(standaloneFixture), { format: "heat", within: "table" });
    const shaded = Array.from(container.querySelectorAll("tbody td")).some((td) => (td as HTMLElement).style.background.includes("rgba"));
    expect(shaded).toBe(true);
  });

  it("formats a percentage-point lens as diverging on its value when standalone", () => {
    const { container } = mount(load(standaloneFixture), { lens: "size_of_impact_pp", format: "diverging" });
    const shaded = Array.from(container.querySelectorAll("tbody td")).some((td) => (td as HTMLElement).style.background.includes("rgba"));
    expect(shaded).toBe(true);
  });

  it("sorts by a column when its header is clicked", async () => {
    const p = load(standaloneFixture);
    const { onView } = mount(p, { cut: "g1" });
    await userEvent.click(screen.getByRole("button", { name: /BSP/ }));
    expect(onView).toHaveBeenCalledWith({ sort: { column: p.columns[1].key, part: "value", dir: "desc" } });
  });

  it("shows each cell's base when details are on", () => {
    const { container } = mount(load(standaloneFixture), { showDetails: true });
    expect(container.textContent).toMatch(/n \d/);
  });
});

describe("GridBody ordering and colour arguments", () => {
  it("lets order and colors props override the presentation rules, unlisted before pinned", () => {
    const p = load(standaloneFixture);
    const { container } = mount(p, {}, {
      rules: { columnOrder: ["SP+"], pinLast: ["BJP+"], entityColors: { Other: "#abcdef" } },
      order: { columns: ["BJP+"], pinLast: ["SP+"] },
      colors: { "BJP+": "#123456" },
    });
    const texts = headerTexts();
    const at = (label: string) => texts.findIndex((t) => t.includes(label));
    expect(at("BJP+")).toBeLessThan(at("BSP"));
    expect(at("BSP")).toBeLessThan(at("Other"));
    expect(at("Other")).toBeLessThan(at("SP+"));
    expect(container.querySelector('span[aria-hidden][style*="rgb(18, 52, 86)"]')).not.toBeNull();
    expect(container.querySelector('span[aria-hidden][style*="rgb(171, 205, 239)"]')).not.toBeNull();
  });
});
