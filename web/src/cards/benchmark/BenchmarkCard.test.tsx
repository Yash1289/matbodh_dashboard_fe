import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BenchmarkPayload, RunStatus, StateContext } from "../../api/types";
import { BENCHMARK, infoFor, stubCardApi } from "../../test/cardApi";
import { renderWithProviders } from "../../test/render";
import { BenchmarkCard } from "./BenchmarkCard";

const CTX: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["R1", "R2"], compare_round: "R1", anchor_round: "R2",
  version_mode: "extrapolated", geo_scope: "state",
};

afterEach(() => vi.unstubAllGlobals());

const mount = (p: BenchmarkPayload) => {
  const f = stubCardApi({ payloads: [p] });
  renderWithProviders(<BenchmarkCard info={infoFor(p)} ctx={CTX} />);
  return f;
};
const runPosts = (f: ReturnType<typeof stubCardApi>) =>
  f.mock.calls.filter(([url, init]) => String(url).endsWith("/cards/run") && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)) as { reference?: unknown });
const withoutReference = (p: BenchmarkPayload): BenchmarkPayload => ({
  ...p, reference: { kind: "none", label: null }, comparisons: [], flips: [],
  summaries: p.summaries.filter((r) => r.endpoint === "target"),
  margin_buckets: p.margin_buckets.filter((r) => r.endpoint === "target"),
  tables_available: ["summary", "margin_buckets"], default_table: "summary",
});

describe("BenchmarkCard", () => {
  it("opens on the comparison table when there is a reference", async () => {
    mount(BENCHMARK.surveyVs2022());
    expect(await screen.findByRole("table", { name: /Comparison/ })).toBeInTheDocument();
  });

  it("opens on the card's own view table: a copy with a different view shows another tab of the same data", async () => {
    mount({ ...BENCHMARK.surveyVs2022(), default_table: "flips" });
    expect(await screen.findByRole("table", { name: /Flips/ })).toBeInTheDocument();
  });

  it("opens on the summary without a reference, and the chooser hides tables that cannot exist", async () => {
    mount(withoutReference(BENCHMARK.surveyVs2022()));
    expect(await screen.findByRole("table", { name: /Summary/ })).toBeInTheDocument();
    const tabs = screen.getByRole("tablist", { name: "Table" });
    expect(within(tabs).getAllByRole("tab").map((o) => o.textContent)).toEqual(["Summary", "Margin buckets"]);
  });

  it("switching tables is display-only and never fetches", async () => {
    const f = mount(BENCHMARK.surveyVs2022());
    await screen.findByRole("table", { name: /Comparison/ });
    const calls = f.mock.calls.length;
    await userEvent.click(screen.getByRole("tab", { name: "Seat flips" }));
    expect(await screen.findByRole("table", { name: /Flips/ })).toBeInTheDocument();
    expect(f.mock.calls.length).toBe(calls);
  });

  it("shows the configured election reference and has no picker; requests carry no reference", async () => {
    const p = BENCHMARK.surveyVs2022();
    const f = stubCardApi({ payloads: [p] });
    const info = { ...infoFor(p), benchmark: { reference: { kind: "election" as const, year: 2022, election_type: "VS" as const } } };
    renderWithProviders(<BenchmarkCard info={info} ctx={CTX} />);
    await screen.findByRole("table", { name: /Comparison/ });
    expect(screen.queryByRole("button", { name: /Reference/ })).toBeNull();
    expect(screen.getByTestId("card-subtitle").textContent).toMatch(/ vs /); // the reference, read-only
    const posts = runPosts(f);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((body) => !("reference" in body))).toBe(true); // the reference is in the card's config
  });

  it("copies the engine's values exactly", async () => {
    const p = BENCHMARK.surveyVs2022();
    mount(p);
    const table = await screen.findByRole("table", { name: /Comparison/ });
    const nda = p.comparisons.find((r) => r.group.set_id === "g0" && r.party === "NDA")!;
    const row = within(table).getAllByRole("row").find((r) => within(r).queryByRole("rowheader", { name: "NDA" }))!;
    const text = row.textContent ?? "";
    expect(text).toContain("154");
    expect(text).toContain("273");
    expect(text).toContain("-119");
    expect(text).toContain(`${nda.target_vote_share!.toFixed(1)}%`);
  });

  it("shows Other last and names it with the payload's label", async () => {
    mount(BENCHMARK.surveyVs2022());
    const table = await screen.findByRole("table", { name: /Comparison/ });
    const header = within(table).getAllByRole("rowheader").map((h) => h.textContent);
    expect(header.filter((t) => t === "Other").length).toBeGreaterThan(0);
  });

  it("shows a dash with the reason for a party missing from an endpoint, never a zero", async () => {
    const p = BENCHMARK.surveyVs2022();
    const g0 = p.comparisons.find((r) => r.group.set_id === "g0")!.group;
    p.parties = [...p.parties, "INDI"];
    p.comparisons.push({
      group: g0, party: "INDI", eligible_seats: 403, target_vote_share: null, reference_vote_share: 1.2,
      vote_share_delta_pp: null, target_seats: null, reference_seats: 2, seat_delta: null,
      seat_share_delta_pp: null, absent_sides: ["target"],
    });
    mount(p);
    const table = await screen.findByRole("table", { name: /Comparison/ });
    const row = within(table).getAllByRole("row").find((r) => within(r).queryByRole("rowheader", { name: "INDI" }))!;
    expect(within(row).getAllByTitle("not in this endpoint's mapping").length).toBeGreaterThan(0);
    expect(within(row).getAllByText("–").length).toBeGreaterThanOrEqual(4);
  });

  it("says so in words when no seat is covered", async () => {
    const p = BENCHMARK.surveyVs2022();
    mount({ ...p, comparisons: [], summaries: [], margin_buckets: [], flips: [] });
    expect(await screen.findByText(/No seats are covered by both endpoints/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("explains how Other is built in the footer", async () => {
    mount(BENCHMARK.surveyVs2022());
    await screen.findByRole("table", { name: /Comparison/ });
    expect(screen.getByTestId("card-footer")).toHaveTextContent(/Other: every party outside the major list, and NOTA/);
  });

  it("clears the old subtitle, chips and method text while a new run is in progress", async () => {
    const p = BENCHMARK.surveyVs2022();
    const runs: Record<string, RunStatus> = {};
    stubCardApi({ payloads: [p], runs });
    const Harness = () => {
      const [ctx, setCtx] = useState<StateContext>(CTX);
      return (
        <>
          <button onClick={() => setCtx({ ...CTX, compare_round: null })}>drop compare</button>
          <BenchmarkCard info={infoFor(p)} ctx={ctx} />
        </>
      );
    };
    renderWithProviders(<Harness />);
    await screen.findByRole("table", { name: /Comparison/ });
    expect(screen.getByTestId("card-subtitle")).toBeInTheDocument();
    runs[p.card_id] = { state: "running", done: 0, total: 1, result: null, errors: {} };
    await userEvent.click(screen.getByRole("button", { name: "drop compare" })); // a new context starts a new run
    expect(await screen.findByText(/Running the benchmark/)).toBeInTheDocument();
    expect(screen.queryByTestId("card-subtitle")).toBeNull();
    expect(screen.queryByRole("button", { name: /Search/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "⋯" })).toBeNull();
  });

  it("says so in words when a search matches nothing", async () => {
    mount(BENCHMARK.surveyVs2022());
    await screen.findByRole("table", { name: /Comparison/ });
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.type(await screen.findByLabelText("Search rows"), "zzzz");
    expect(await screen.findByText(/No rows match/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  describe("tables", () => {
    const open = async (tab: string, p = BENCHMARK.surveyVs2022()) => {
      mount(p);
      await screen.findByRole("table", { name: /Comparison/ });
      await userEvent.click(screen.getByRole("tab", { name: tab }));
    };

    it("merges vote share and seats, with their changes, in one Summary cell per party, All seats first", async () => {
      await open("Summary");
      const table = await screen.findByRole("table", { name: /Summary/ });
      const rows = within(table).getAllByRole("row");
      const first = rows[1];
      expect(within(first).getByRole("rowheader")).toHaveTextContent("All seats");
      const cells = within(first).getAllByRole("cell");
      const nda = cells[1].textContent ?? "";
      expect(nda).toContain("42.1%");
      expect(nda).toContain("▼ 1.8 pp");
      expect(nda).toContain("154");
      expect(nda).toContain("▼ 119");
      expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
        expect.arrayContaining(["BSP", "NDA", "SP+", "Other"]));
    });

    it("groups the Comparison headers into vote share and seats won, with the share of seats", async () => {
      mount(BENCHMARK.surveyVs2022());
      const table = await screen.findByRole("table", { name: /Comparison/ });
      const heads = within(table).getAllByRole("columnheader").map((h) => h.textContent);
      expect(heads).toEqual(expect.arrayContaining(["Vote share", "Seats won", "Share of seats"]));
      const nda = within(table).getAllByRole("row").find((r) => within(r).queryByRole("rowheader", { name: "NDA" }))!;
      expect(nda.textContent).toContain("-29.5 pp");
    });

    it("lists the six margin rows and a total of 403 on each side", async () => {
      await open("Margin buckets");
      const table = await screen.findByRole("table", { name: /Margin buckets/ });
      const all = within(table).getAllByRole("rowgroup")[1]; // first group: all seats
      expect(within(all).getAllByRole("row").length).toBe(1 + 6 + 1);
      const total = within(all).getAllByRole("row").slice(-1)[0];
      expect(total.textContent).toContain("All eligible seats");
      expect((total.textContent?.match(/403/g) ?? []).length).toBe(2);
      expect(within(all).getAllByRole("row").some((r) => /Ahead/.test(r.textContent ?? ""))).toBe(true);
      expect(within(all).getAllByRole("row").some((r) => /Behind/.test(r.textContent ?? ""))).toBe(true);
    });

    it("shows the four flip classes with their engine counts and a bar that says the same in words", async () => {
      await open("Seat flips");
      const table = await screen.findByRole("table", { name: /Flips/ });
      const text = table.textContent ?? "";
      for (const n of ["132", "22", "141", "108"]) expect(text).toContain(n);
      const bar = screen.getAllByRole("img")[0];
      expect(bar.getAttribute("aria-label")).toMatch(/Winning both 132.*Gain 22.*Loss 141.*Losing both 108 of 403 seats/);
    });

    it("marks the reference as a read-only changed tag, not a control", async () => {
      mount(BENCHMARK.surveyVs2022());
      await screen.findByRole("table", { name: /Comparison/ });
      const tag = screen.getByTestId("reference-tag");
      expect(tag).toHaveAttribute("data-changed", "true");
      expect(tag.tagName).not.toBe("BUTTON");
    });
  });
});
