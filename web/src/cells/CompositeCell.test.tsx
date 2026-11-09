import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import runScoreboard from "../test/fixtures/run_scoreboard_done.json";
import type { Cell, RunStatus } from "../api/types";
import { CompositeCell } from "./CompositeCell";
import { SeatsCell } from "./SeatsCell";
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

  it("delta tone follows the sign and keeps the arrow", () => {
    const tone = (delta: number | null) => {
      const { unmount, container } = render(<CompositeCell cell={cell({ delta })} unit="pct" parts={["value", "delta"]} rounds={rounds} />);
      const el = container.querySelector("[data-tone]") as HTMLElement;
      const out = { tone: el.getAttribute("data-tone"), colour: el.style.color, text: el.textContent };
      unmount();
      return out;
    };
    expect(tone(-0.6)).toEqual({ tone: "loss", colour: "var(--mb-loss)", text: "▼0.60%" });
    expect(tone(1.4)).toEqual({ tone: "gain", colour: "var(--mb-gain)", text: "▲1.40%" });
    for (const neutral of [0, null]) {
      const t = tone(neutral);
      expect(t.tone).toBe("neutral");
      expect(t.colour).toBe("var(--mb-muted)");
      expect(t.text).not.toMatch(/[▲▼]/);
    }
  });

  it("cell lays out value left and delta right", () => {
    const { container } = render(<CompositeCell cell={cell({})} unit="pct" parts={["value", "delta", "trend"]} rounds={rounds} />);
    const main = container.querySelector('[data-row="main"]') as HTMLElement;
    const sub = container.querySelector('[data-row="sub"]') as HTMLElement;
    expect(main.firstElementChild!.textContent).toBe("38%");
    expect(main.lastElementChild!.textContent).toBe("▼1.50%");
    expect(main.contains(sub)).toBe(false);
    expect(main.nextElementSibling).toBe(sub);
    expect(sub.textContent).toBe("40% | 38%");
  });

  it("null cell shows the reason as its sub-line", () => {
    const { container, unmount } = render(<CompositeCell cell={cell({ value: null, delta: null, trend: [], flags: ["not_contender"] })} unit="seats" parts={["value"]} rounds={rounds} />);
    expect(container.querySelector('[data-row="main"]')!.textContent).toBe("—");
    expect(container.querySelector('[data-row="sub"]')!.textContent).toBe("Not a seat contender");
    unmount();
    const r = render(<CompositeCell cell={null} unit="pct" parts={["value"]} rounds={rounds} />);
    expect(r.container.querySelector('[data-row="sub"]')!.textContent).toBe("Not applicable");
  });
});

describe("SeatsCell", () => {
  const board = (runScoreboard as unknown as RunStatus).result!.scoreboard!;
  const nda = board[0];
  const PARTS = ["value", "delta", "trend"] as const;
  const seats = (ac: Cell | null, pc: Cell | null) => render(<SeatsCell ac={ac} pc={pc} rounds={rounds} parts={[...PARTS]} />);
  const mainText = (c: HTMLElement) => c.querySelector('[data-row="main"]')!.firstElementChild!.textContent;

  it("merged seats cell", () => {
    const { container } = seats(nda.seats_ac, nda.seats_pc);
    expect(mainText(container)).toBe("154 · 26");
    const deltas = [...container.querySelectorAll("[data-tone]")];
    expect(deltas.map((d) => d.textContent)).toEqual(["▼88", "▼22"]);
    expect(deltas.map((d) => d.getAttribute("data-tone"))).toEqual(["loss", "loss"]);
    expect(container.querySelector('[data-row="sub"]')!.textContent).toBe("R1 243 · 49 | R2 154 · 26");
    const sp = board[1];
    const mixed = seats(sp.seats_ac, { ...sp.seats_pc!, delta: 0 });
    const tones = [...mixed.container.querySelectorAll("[data-tone]")].map((d) => d.getAttribute("data-tone"));
    expect(tones).toEqual(["gain", "neutral"]);
  });

  it("borrowed AC seats carry an asterisk", () => {
    const { container } = seats({ ...nda.seats_ac!, flags: ["borrowed"] }, nda.seats_pc);
    expect(mainText(container)).toBe("154* · 26");
  });

  it("merged seats cell reports a missing level", () => {
    const failed: Cell = { value: null, delta: null, trend: [null, null], secondary: null, flags: ["failed", "no_delta"], base: null };
    const { container, unmount } = seats(nda.seats_ac, failed);
    expect(mainText(container)).toBe("154 · —");
    expect(container.querySelector('[data-row="main"] [title="Calculation failed for this round"]')!.textContent).toBe("—");
    expect(container.querySelector('[data-row="sub"]')!.textContent).toBe("R1 243 · — | R2 154 · —");
    unmount();
    const both = seats(null, failed);
    expect(both.container.querySelector('[data-row="main"]')!.textContent).toBe("—");
    expect(both.container.querySelector('[data-row="sub"]')!.textContent).toBe("Not applicable; Calculation failed for this round");
  });
});
