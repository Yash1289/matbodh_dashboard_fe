import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import leaders from "../test/fixtures/run_leaders_done.json";
import scoreboardDone from "../test/fixtures/run_scoreboard_done.json";
import scoreboardPartial from "../test/fixtures/run_scoreboard_partial.json";
import type { CardResult, CellPart, RunStatus } from "../api/types";
import { CompositeTable } from "./CompositeTable";
import { opinionGrid, scoreboardGrid } from "./grid";

const res = (f: unknown): CardResult => (f as RunStatus).result!;
const done = res(scoreboardDone);
const D_TITLE = "Δ 2027 VS CAPI R2 − 2027 VS CAPI R1";
const row = (name: string): HTMLElement => screen.getByText(name).closest("tr")!;

function show(result: CardResult, parts: CellPart[], extra: Partial<Parameters<typeof CompositeTable>[0]> = {}) {
  const grid = result.operation === "opinion" ? opinionGrid(result) : scoreboardGrid(result);
  return render(<CompositeTable grid={grid} parts={parts} rounds={result.rounds} rule={{ kind: "none" }} sort={null} onSort={() => {}} {...extra} />);
}

describe("CompositeTable", () => {
  it("scoreboard delta comes from the engine, not subtraction", () => {
    expect(scoreboardGrid(done).cells.NDA.vote.cell!.delta).toBe(-1.5);
    show(done, ["value", "delta"]);
    const nda = row("NDA (BJP+)");
    expect(nda.textContent).toContain("▼1.50%");
    expect(nda.textContent).not.toContain("▼2%");
    expect(nda.textContent).toContain("38%");
    expect(nda.textContent).not.toMatch(/38\.\d/);
  });

  it("partial run keeps failed seat column with dashes", () => {
    show(res(scoreboardPartial), ["value"]);
    expect(screen.getByText("Seats PC")).toBeTruthy();
    const nda = row("NDA (BJP+)");
    expect(within(nda).getByTitle("Calculation failed for this round").textContent).toBe("—");
  });

  it("opinion not-asked round is dash with reason", () => {
    show(res(leaders), ["value", "trend"]);
    expect(row("cm_satisfaction").textContent).toContain("— | +5%");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("not_returned questions are rows of dashes with a note", () => {
    show(res(leaders), ["value"]);
    const r = row("state_govt_satisfaction");
    expect(r.textContent).toContain("No result returned");
    expect(within(r).getByTitle("Not applicable").textContent).toBe("—");
  });

  it("delta header names both rounds in full", () => {
    show(done, ["value", "delta"]);
    expect(screen.getAllByTitle(D_TITLE).length).toBeGreaterThan(0);
    expect(screen.getByText(/Anchor round: 2027 VS CAPI R2/)).toBeTruthy();
    const texts = [...document.querySelectorAll("*")].flatMap((e) => [e.textContent?.trim(), e.getAttribute("title")]);
    expect(texts).not.toContain("R1");
    expect(texts).not.toContain("R2");
  });

  it("clicking a column header cycles desc, asc, none", async () => {
    const onSort = vi.fn();
    const u = userEvent.setup();
    const { rerender } = show(done, ["value"], { onSort });
    await u.click(screen.getByRole("button", { name: /Vote share/ }));
    expect(onSort).toHaveBeenLastCalledWith({ column: "vote", part: "value", dir: "desc" });
    rerender(<CompositeTable grid={scoreboardGrid(done)} parts={["value"]} rounds={done.rounds} rule={{ kind: "none" }}
      sort={{ column: "vote", part: "value", dir: "desc" }} onSort={onSort} />);
    await u.click(screen.getByRole("button", { name: /Vote share/ }));
    expect(onSort).toHaveBeenLastCalledWith({ column: "vote", part: "value", dir: "asc" });
    rerender(<CompositeTable grid={scoreboardGrid(done)} parts={["value"]} rounds={done.rounds} rule={{ kind: "none" }}
      sort={{ column: "vote", part: "value", dir: "asc" }} onSort={onSort} />);
    await u.click(screen.getByRole("button", { name: /Vote share/ }));
    expect(onSort).toHaveBeenLastCalledWith(null);
  });

  it("sorts rows from sort prop and shows legend only with a rule", () => {
    const { container } = show(done, ["value"], { sort: { column: "vote", part: "value", dir: "asc" }, rule: { kind: "heat", within: "column" } });
    const names = [...container.querySelectorAll("tbody th")].map((t) => t.textContent);
    expect(names[0]).toContain("Other");
    expect(screen.getByText(/Heat on value/)).toBeTruthy();
  });
});
