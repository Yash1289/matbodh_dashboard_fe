import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import runScoreboard from "../test/fixtures/run_scoreboard_done.json";
import type { Cell, RunStatus } from "../api/types";
import { CompositeCell } from "./CompositeCell";
import { deltaTitle } from "./parts";

const rounds = (runScoreboard as unknown as RunStatus).result!.rounds;
const cell = (over: Partial<Cell>): Cell => ({
  value: 38, delta: -1.5, trend: [40, 38], secondary: null, flags: [], base: null, ...over,
});
const ALL = ["value", "delta", "trend", "base", "secondary", "flags"] as const;

describe("CompositeCell", () => {
  it("not-asked cell shows dash with reason", () => {
    render(<CompositeCell cell={null} unit="pct" parts={[...ALL]} rounds={rounds} />);
    expect(screen.getByTitle("Not applicable").textContent).toBe("—");
    render(<CompositeCell cell={cell({ value: null, flags: ["not_asked"] })} unit="pct" parts={["value"]} rounds={rounds} />);
    expect(screen.getByTitle("Not asked in this round").textContent).toBe("—");
  });

  it("delta title names both rounds in full", () => {
    expect(deltaTitle(rounds)).toBe("Δ 2027 VS CAPI R2 − 2027 VS CAPI R1");
    render(<CompositeCell cell={cell({})} unit="pct" parts={["value", "delta"]} rounds={rounds} />);
    expect(screen.getByTitle("Δ 2027 VS CAPI R2 − 2027 VS CAPI R1").textContent).toBe("▼1.50%");
  });

  it("no compare round hides delta", () => {
    render(<CompositeCell cell={cell({})} unit="pct" parts={["value", "delta"]} rounds={{ ...rounds, compare: null }} />);
    expect(screen.queryByText(/▼/)).toBeNull();
    expect(screen.getByText("38%")).toBeTruthy();
  });

  it("five rounds render a sparkline, four render pipes", () => {
    const five = { ...rounds, items: [...rounds.items, ...rounds.items, rounds.items[0]] };
    const { unmount } = render(<CompositeCell cell={cell({ trend: [1, 2, 3, 4, 5] })} unit="pct" parts={["trend"]} rounds={five} />);
    expect(screen.getByLabelText("trend across 5 rounds")).toBeTruthy();
    unmount();
    render(<CompositeCell cell={cell({ trend: [40, 38, 36, null] })} unit="pct" parts={["trend"]} rounds={rounds} />);
    expect(screen.queryByLabelText(/trend across/)).toBeNull();
    expect(screen.getByText("40% | 38% | 36% | —")).toBeTruthy();
  });

  it("unknown flag rendered", () => {
    render(<CompositeCell cell={cell({ flags: ["weird"] })} unit="pct" parts={["flags"]} rounds={rounds} />);
    const f = screen.getByTitle("weird");
    expect(f.textContent).toBe("?");
    expect(f.getAttribute("aria-label")).toBe("weird");
  });

  it("null delta with a compare round carries its reason in the title", () => {
    const { unmount } = render(<CompositeCell cell={cell({ delta: null, flags: ["no_delta"] })} unit="pct" parts={["value", "delta"]} rounds={rounds} />);
    expect(screen.getByTitle("Δ 2027 VS CAPI R2 − 2027 VS CAPI R1: No Δ available for this round pair").textContent).toBe("—");
    unmount();
    render(<CompositeCell cell={cell({ value: null, delta: null, flags: ["not_asked"] })} unit="pct" parts={["value", "delta"]} rounds={rounds} />);
    expect(screen.getByTitle("Δ 2027 VS CAPI R2 − 2027 VS CAPI R1: Not asked in this round")).toBeTruthy();
  });

  it("no_delta renders no invisible span and flags are images", () => {
    const { container } = render(<CompositeCell cell={cell({ flags: ["no_delta", "low_base"] })} unit="pct" parts={["flags"]} rounds={rounds} />);
    expect(container.querySelectorAll("[aria-label]")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Low base" }).textContent).toBe("◌");
  });
});
