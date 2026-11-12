import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RankedPayload, RunStatus, StateContext } from "../../api/types";
import { RANKED, infoFor, stubCardApi } from "../../test/cardApi";
import { renderWithProviders } from "../../test/render";
import { RankingCard } from "./RankingCard";

const CTX: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["R1", "R2"], compare_round: "R1", anchor_round: "R2",
  version_mode: "extrapolated", geo_scope: "state",
};

afterEach(() => vi.unstubAllGlobals());

const mount = (p: RankedPayload) => renderWithProviders(<RankingCard info={infoFor(p)} ctx={CTX} />);
const bodyRows = (table: HTMLElement) => within(table).getAllByRole("row").slice(1);

describe("RankingCard", () => {
  it("renders the seat ranking capped at 100 rows and shows 100 more on request", async () => {
    const p = RANKED.seatStandalone();
    stubCardApi({ payloads: [p] });
    mount(p);
    const table = await screen.findByRole("table");
    expect(screen.getByRole("heading", { name: `Card ${p.card_id}` })).toBeInTheDocument();
    expect(bodyRows(table)).toHaveLength(100);
    await userEvent.click(screen.getByRole("button", { name: "Show 100 more" }));
    expect(bodyRows(table)).toHaveLength(200);
  });

  it("shows rank pipes in round order with a reason for a seat the later round did not rank", async () => {
    const p = RANKED.seatTrend();
    stubCardApi({ payloads: [p] });
    mount(p);
    const table = await screen.findByRole("table");
    const row = within(table).getByRole("rowheader", { name: /Seat 128/ }).closest("tr")!;
    const segments = within(row).getAllByLabelText(/^R[12]:/);
    expect(segments.map((s) => s.getAttribute("aria-label"))).toEqual(expect.arrayContaining([
      "R1: not ranked in R1", "R2: rank 1"]));
    expect(within(row).getAllByTitle("not ranked in R1").length).toBeGreaterThan(0);
  });

  it("explains a seat outside the top k and a failed round", async () => {
    const p = RANKED.seatTrend();
    p.top_k = 3;
    p.absent = p.absent.map((a) => ({ ...a, reason: "outside_top_k" }));
    stubCardApi({ payloads: [p] });
    mount(p);
    await screen.findByRole("table");
    expect(screen.getAllByTitle("outside top 3 in R1").length).toBeGreaterThan(0);
  });

  it("sorts by a later round's rank without leaving the page", async () => {
    const p = RANKED.seatTrend();
    const f = stubCardApi({ payloads: [p] });
    mount(p);
    const table = await screen.findByRole("table");
    expect(within(bodyRows(table)[0]).getByRole("rowheader")).toHaveTextContent("Seat 128");
    const calls = f.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /Sort/ }));
    await userEvent.selectOptions(await screen.findByLabelText("Sort"), "o1:rank:asc");
    expect(within(bodyRows(table)[0]).getByRole("rowheader")).not.toHaveTextContent("Seat 128");
    expect(f.mock.calls.length).toBe(calls); // display controls never fetch
  });

  describe("a chosen sort follows its round when the round selection changes", () => {
    const renamed = (p: RankedPayload, names: string[]): RankedPayload => ({
      ...p, rounds: { ...p.rounds, items: p.rounds.items.map((i, n) => ({ ...i, base_name: names[n], label: names[n] })) },
    });

    async function sortR2ThenSwitchTo(names: string[]) {
      const p = RANKED.seatTrend();
      names = names.map((n) => (n === "R2" ? p.rounds.items[1].base_name : n)); // keep the fixture's real name for the sorted round
      const runs: Record<string, RunStatus> = {};
      stubCardApi({ payloads: [p], runs });
      const Harness = () => {
        const [ctx, setCtx] = useState(CTX);
        return (
          <>
            <button onClick={() => { runs[p.card_id] = { state: "done", done: 1, total: 1, result: renamed(p, names), errors: {} }; setCtx({ ...CTX, rounds: names }); }}>switch</button>
            <RankingCard info={infoFor(p)} ctx={ctx} />
          </>
        );
      };
      renderWithProviders(<Harness />);
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("button", { name: /Sort/ }));
      await userEvent.selectOptions(await screen.findByLabelText("Sort"), "o2:rank:asc"); // o2 is R2 here
      await userEvent.click(screen.getByRole("button", { name: "switch" }));
      await screen.findByText(new RegExp(`trend ${names.join(" \\| ")}`));
      if (screen.queryByLabelText("Sort") === null) await userEvent.click(screen.getByRole("button", { name: /Sort/ }));
      return (await screen.findByLabelText("Sort")) as HTMLSelectElement;
    }

    it("clears the sort when its round is no longer shown", async () => {
      expect((await sortR2ThenSwitchTo(["R3", "R4"])).value).toBe("");
    });

    it("keeps sorting by the same round when it moves position", async () => {
      expect((await sortR2ThenSwitchTo(["R2", "R3"])).value).toBe("o1:rank:asc");
    });
  });

  it("search and details are display-only", async () => {
    const p = RANKED.seatTrend();
    const f = stubCardApi({ payloads: [p] });
    mount(p);
    const table = await screen.findByRole("table");
    const calls = f.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.type(await screen.findByLabelText("Search rows"), "seat 128");
    expect(bodyRows(table)).toHaveLength(1);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(f.mock.calls.length).toBe(calls);
  });

  it("shows group headers and level values for a demographic ranking", async () => {
    const p = RANKED.demographic();
    stubCardApi({ payloads: [p] });
    mount(p);
    await screen.findByRole("table");
    expect(screen.getByText("AC 1")).toBeInTheDocument();
    expect(screen.queryByText(/ac_num/)).toBeNull();
    expect(screen.getAllByRole("rowheader", { name: /Other OBC/ }).length).toBeGreaterThan(0);
  });

  it("a partial run says which round failed and marks its slots", async () => {
    const p = RANKED.seatTrend();
    p.absent = p.absent.map((a) => ({ ...a, reason: "round_failed" }));
    const run: RunStatus = {
      state: "partial", done: 2, total: 2, result: p,
      errors: { grid: { kind: "infrastructure", message: "x", fingerprint: null, jobs: ["rank:o1"] } },
    };
    stubCardApi({ payloads: [p], runs: { [p.card_id]: run } });
    mount(p);
    expect(await screen.findByText(/Some parts failed: R1/)).toBeInTheDocument();
    expect(screen.getAllByTitle("calculation failed in R1").length).toBeGreaterThan(0);
  });

  it("shows the engine reason and no table for an unavailable card", async () => {
    const p = RANKED.seatStandalone();
    stubCardApi({ payloads: [p], unavailable: { [p.card_id]: [{ part: "grid", reason: "AC-level ranking is not available for PC-level surveys" }] } });
    mount(p);
    expect(await screen.findByText(/AC-level ranking is not available/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
  });

  it("says so when the engine returned no ranked rows", async () => {
    const p = RANKED.demographic();
    p.groups = []; p.entities = []; p.ranks = []; p.absent = [];
    stubCardApi({ payloads: [p] });
    mount(p);
    expect(await screen.findByText("The engine returned no ranked rows.")).toBeInTheDocument();
  });

  it("says so when a search matches nothing", async () => {
    const p = RANKED.seatTrend();
    stubCardApi({ payloads: [p] });
    mount(p);
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.type(await screen.findByLabelText("Search rows"), "zzzz");
    expect(screen.getByText(/No rows match/)).toBeInTheDocument();
  });

  it("keeps the tie marker when a search hides the tied row", async () => {
    const p = RANKED.seatStandalone();
    const [a, b] = p.groups[0].entities;
    p.ranks = p.ranks.map((r) => (r.entity === a || r.entity === b ? { ...r, rank: 1 } : r));
    stubCardApi({ payloads: [p] });
    mount(p);
    await screen.findByRole("table");
    const name = p.entities.find((e) => e.key === a)!.labels.name ?? `${p.entities.find((e) => e.key === a)!.labels.seat_id}`;
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.type(await screen.findByLabelText("Search rows"), name);
    expect(screen.getAllByLabelText(/rank 1 \(tied\)/).length).toBeGreaterThan(0);
  });
});
