import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardConfigJson } from "../api/types";
import { _dropMemory } from "../configure/cardStore";
import { renderWithProviders } from "../test/render";
import { tokens } from "../theme";
import { Canvas, NARROW_PAGE } from "./Canvas";
import { _dropWorkspaceMemory, workspaceStore } from "./workspaceStore";

// jsdom cannot drag. The grid library is replaced by a stub that records its props, so these tests cover our
// glue (width choice, handle, what gets saved); real dragging is checked in the browser test (e2e/canvas.spec.ts).
type GridProps = {
  width: number; layout: { i: string; x: number; y: number; w: number; h: number }[];
  gridConfig: { cols: number }; dragConfig: { enabled: boolean; handle?: string }; resizeConfig: { enabled: boolean };
  onDragStop(layout: GridProps["layout"]): void; onResizeStop(layout: GridProps["layout"]): void;
  children: React.ReactNode;
};
let grid: GridProps | null = null;
vi.mock("react-grid-layout", () => ({
  GridLayout: (props: GridProps) => { grid = props; return <div data-testid="grid">{props.children}</div>; },
}));

const STATE = "Uttar Pradesh";
const CONFIG: CardConfigJson = { id: "x", family: "distribution", title: "Vote", scenarios: ["vs_voting_intention"], cuts: [[]] };

function pageWidth(width: number) {
  class RO {
    constructor(private cb: ResizeObserverCallback) {}
    observe() { this.cb([{ borderBoxSize: [{ inlineSize: width, blockSize: 300 }], contentRect: { width, height: 300 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
}

beforeEach(() => { grid = null; });
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  _dropMemory();
  _dropWorkspaceMemory();
});

function setup(width: number) {
  pageWidth(width);
  const a = workspaceStore.addCard(STATE, CONFIG);
  const b = workspaceStore.addCard(STATE, CONFIG);
  const tab = workspaceStore.get(STATE).tabs[0];
  renderWithProviders(<Canvas state={STATE} tab={tab} renderCard={(id) => <p>card {id}</p>} onConfigure={() => {}} />);
  return { a, b, tab };
}

describe("Canvas", () => {
  it("renders one cell per item with the card's own content", async () => {
    const { a, b } = setup(900);
    expect(await screen.findByText(`card ${a.id}`)).toBeInTheDocument();
    expect(screen.getByText(`card ${b.id}`)).toBeInTheDocument();
  });

  it("at a wide page the cells sit on a 12-column grid with a drag handle and resizing", async () => {
    const { tab } = setup(900);
    await screen.findByTestId("grid");
    expect(grid!.gridConfig.cols).toBe(12);
    expect(grid!.dragConfig).toMatchObject({ enabled: true, handle: ".canvas-handle" });
    expect(grid!.resizeConfig.enabled).toBe(true);
    expect(grid!.layout.map((l) => l.i)).toEqual(tab.items.map((i) => i.cardId));
    expect(screen.getAllByLabelText("Drag card")).toHaveLength(2);
  });

  it(`below ${NARROW_PAGE}px the cards are one column in reading order, with no grid and no handle`, async () => {
    const { a, b } = setup(500);
    await waitFor(() => expect(screen.queryByTestId("grid")).toBeNull());
    expect(screen.queryByLabelText("Drag card")).toBeNull();
    const text = screen.getAllByText(/^card /).map((p) => p.textContent);
    expect(text).toEqual([`card ${a.id}`, `card ${b.id}`]);
  });

  it("every cell has the card menu, on the grid and in one column", async () => {
    setup(900);
    expect(await screen.findAllByRole("button", { name: "Card actions" })).toHaveLength(2);
  });

  it("lays out at the usual page width until the width is known", () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    workspaceStore.addCard(STATE, CONFIG);
    renderWithProviders(<Canvas state={STATE} tab={workspaceStore.get(STATE).tabs[0]} renderCard={(id) => <p>card {id}</p>} onConfigure={() => {}} />);
    expect(screen.getByTestId("grid")).toBeInTheDocument();
    expect(grid!.width).toBe(tokens.layout.content);
  });

  it("saves the layout once when a drag ends, not while it moves", async () => {
    const { a, b, tab } = setup(900);
    await screen.findByTestId("grid");
    const save = vi.spyOn(workspaceStore, "setItems");
    grid!.onDragStop([{ i: a.id, x: 6, y: 0, w: 6, h: 4 }, { i: b.id, x: 0, y: 4, w: 12, h: 8 }]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0].slice(0, 2)).toEqual([STATE, tab.id]);
    await waitFor(() => expect(workspaceStore.get(STATE).tabs[0].items.find((i) => i.cardId === a.id)).toMatchObject({ x: 6, y: 0, w: 6, h: 4 }));
  });

  it("saves the layout once when a resize ends", async () => {
    const { a, b } = setup(900);
    await screen.findByTestId("grid");
    const save = vi.spyOn(workspaceStore, "setItems");
    grid!.onResizeStop([{ i: a.id, x: 0, y: 0, w: 4, h: 6 }, { i: b.id, x: 0, y: 6, w: 12, h: 8 }]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(workspaceStore.get(STATE).tabs[0].items.find((i) => i.cardId === a.id)).toMatchObject({ w: 4, h: 6 });
  });
});
