import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RelationshipPayload, RunStatus, StateContext } from "../../api/types";
import { RELATIONSHIP, infoFor, stubCardApi } from "../../test/cardApi";
import { renderWithProviders } from "../../test/render";
import { RelationshipCard } from "./RelationshipCard";

const CTX: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["R1", "R2"], compare_round: "R1", anchor_round: "R2",
  version_mode: "extrapolated", geo_scope: "state",
};

afterEach(() => vi.unstubAllGlobals());

const mount = (p: RelationshipPayload, options: Parameters<typeof stubCardApi>[0] = { payloads: [p] }) => {
  const f = stubCardApi(options);
  renderWithProviders(<RelationshipCard info={infoFor(p)} ctx={CTX} />);
  return f;
};
const pick = async (chip: RegExp, label: string, value: string) => {
  await userEvent.click(screen.getByRole("button", { name: chip }));
  await userEvent.selectOptions(await screen.findByLabelText(label), value);
};
const withTwoDimensions = (p: RelationshipPayload): RelationshipPayload => {
  const age = (g: { set_id: string; dimensions: Record<string, string> }) =>
    ({ ...g, dimensions: { ...g.dimensions, age_group: g.dimensions.gender === "Female" ? "18-25" : "26-35" } });
  return { ...p, groups: p.groups.map(age), cells: p.cells.map((c) => ({ ...c, group: age(c.group) })),
    summaries: p.summaries.map((s) => ({ ...s, group: age(s.group) })) };
};

describe("RelationshipCard", () => {
  it("opens on Flow summary by default", async () => {
    mount(RELATIONSHIP.transition());
    expect(await screen.findByRole("table", { name: /Flow summary/ })).toBeInTheDocument();
  });

  it("opens on the matrix when the payload's default table is the matrix", async () => {
    mount({ ...RELATIONSHIP.transition(), default_table: "matrix" });
    expect(await screen.findByRole("table", { name: /Matrix/ })).toBeInTheDocument();
  });

  it("switching tables, round, group, search and details never fetch", async () => {
    const f = mount(RELATIONSHIP.transition());
    await screen.findByRole("table", { name: /Flow summary/ });
    const calls = f.mock.calls.length;
    await userEvent.click(screen.getByRole("tab", { name: "Matrix" }));
    expect(await screen.findByRole("table", { name: /Matrix/ })).toBeInTheDocument();
    await pick(/Round/, "Round", "R1");
    await pick(/gender/i, "gender", "Female");
    expect(screen.getByRole("table", { name: /R1 · Female/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("columnheader", { name: "Paired respondents" })).toBeInTheDocument();
    expect(f.mock.calls.length).toBe(calls);
  });

  it("lists only the rounds that have data in the Round chip (a round without the scenarios is not asked)", async () => {
    const p = RELATIONSHIP.transition();
    p.summaries = p.summaries.filter((s) => s.round === "R2");
    p.cells = p.cells.filter((c) => c.round === "R2");
    p.not_asked = [{ part: "grid", rounds: ["2027 VS CAPI R1"] }];
    mount({ ...p, default_table: "matrix" });
    await screen.findByRole("table", { name: /Matrix/ });
    await userEvent.click(screen.getByRole("button", { name: /Round/ }));
    const chooser = await screen.findByLabelText("Round");
    expect(within(chooser).getAllByRole("option").map((o) => o.textContent)).toEqual(["R2"]);
    expect(screen.getByTestId("card-footer")).toHaveTextContent(/Not asked in 2027 VS CAPI R1/);
  });

  it("says so when the chosen value pair does not exist", async () => {
    mount({ ...withTwoDimensions(RELATIONSHIP.transition()), default_table: "matrix" });
    await screen.findByRole("table", { name: /Matrix/ });
    await pick(/gender/i, "gender", "Female");
    await pick(/age_group/i, "age_group", "26-35"); // Female is only in 18-25
    expect(await screen.findByText("No such group in this round")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("search filters the summary groups and never fetches", async () => {
    const f = mount(RELATIONSHIP.transition());
    await screen.findByRole("table", { name: /Flow summary/ });
    const calls = f.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /Search/ }));
    await userEvent.type(await screen.findByLabelText("Search rows"), "fem");
    expect(screen.queryByRole("rowheader", { name: "Male" })).toBeNull();
    expect(screen.getByRole("rowheader", { name: "Female" })).toBeInTheDocument();
    expect(f.mock.calls.length).toBe(calls);
  });

  it("says so when the engine returned no groups", async () => {
    const p = RELATIONSHIP.transition();
    mount({ ...p, groups: [], summaries: [], cells: [] });
    expect(await screen.findByText("The engine returned no relationship rows.")).toBeInTheDocument();
  });

  it("shows the engine reason and no table for an unavailable card", async () => {
    const p = RELATIONSHIP.transition();
    mount(p, { payloads: [p], unavailable: { [p.card_id]: [{ part: "grid", reason: "Focal party 'INC' is not a major party in the alliance mapping" }] } });
    expect(await screen.findByText(/not a major party/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
  });

  it("a failed run shows a kind-specific message and never the raw infrastructure error", async () => {
    const p = RELATIONSHIP.transition();
    const run: RunStatus = { state: "failed", done: 1, total: 1, result: null,
      errors: { grid: { kind: "infrastructure", message: "connection to 10.0.0.5 refused", fingerprint: null, jobs: ["relationship"] } } };
    mount(p, { payloads: [p], runs: { [p.card_id]: run } });
    expect(await screen.findByText(/Temporary engine problem/)).toBeInTheDocument();
    expect(screen.queryByText(/10\.0\.0\.5/)).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("clears the old subtitle, chips and table while a new run is in progress", async () => {
    const p = RELATIONSHIP.transition();
    const runs: Record<string, RunStatus> = {};
    mount(p, { payloads: [p], runs });
    await screen.findByRole("table", { name: /Flow summary/ });
    expect(screen.getByTestId("card-subtitle")).toBeInTheDocument();
    runs[p.card_id] = { state: "running", done: 0, total: 1, result: null, errors: {} };
    await userEvent.click(screen.getByRole("button", { name: "⋯" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Refresh" }));
    expect(await screen.findByText(/Running/)).toBeInTheDocument();
    expect(screen.queryByTestId("card-subtitle")).toBeNull();
    expect(screen.queryByRole("button", { name: /Search/ })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("the footer says what the numbers are", async () => {
    mount(RELATIONSHIP.transition());
    await screen.findByRole("table", { name: /Flow summary/ });
    const footer = screen.getByTestId("card-footer");
    expect(footer).toHaveTextContent("Recalled vote, not longitudinal linkage");
    expect(footer).toHaveTextContent("Shares include respondents who chose smaller parties");
    expect(footer).toHaveTextContent(/Method: rules/);
  });

  it("a current-survey origin says same-row answers, not a panel", async () => {
    mount({ ...RELATIONSHIP.transition(), origin: "mla_choice_party" });
    await screen.findByRole("table", { name: /Flow summary/ });
    expect(screen.getByTestId("card-footer")).toHaveTextContent("Same-row answers, not a panel");
  });

  it("the method drawer states a recalled-status inclusion", async () => {
    mount({ ...RELATIONSHIP.transition(), answer_overrides: { origin: { include: ["Did Not Vote", "Do Not Remember"] } } });
    await screen.findByRole("table", { name: /Flow summary/ });
    await userEvent.click(screen.getByRole("button", { name: "⋯" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "How this was calculated" }));
    expect(await screen.findByText(/Recalled statuses included.*origin: Did Not Vote, Do Not Remember/)).toBeInTheDocument();
  });

  it("names an asked round that came back with no result", async () => {
    const p = RELATIONSHIP.transition();
    p.summaries = p.summaries.filter((s) => s.round === "R2");
    p.cells = p.cells.filter((c) => c.round === "R2");
    mount(p);
    await screen.findByRole("table", { name: /Flow summary/ });
    expect(screen.getByTestId("card-footer")).toHaveTextContent(/No result in 2027 VS CAPI R1/);
  });

  it("the method drawer names the joint weight and the alliance mapping version", async () => {
    mount(RELATIONSHIP.transition());
    await screen.findByRole("table", { name: /Flow summary/ });
    await userEvent.click(screen.getByRole("button", { name: "⋯" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "How this was calculated" }));
    expect(await screen.findByText(/Joint weight: base/)).toBeInTheDocument();
    expect(screen.getByText(/Alliance mapping 2027-01-01/)).toBeInTheDocument();
  });

  it("exports the table on screen as CSV", async () => {
    mount(RELATIONSHIP.transition());
    await screen.findByRole("table", { name: /Flow summary/ });
    const click = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = create(tag);
      if (tag === "a") el.click = click;
      return el;
    });
    await userEvent.click(screen.getByRole("button", { name: "⋯" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Export CSV" }));
    expect(click).toHaveBeenCalledOnce();
  });

  it("chooses between its two tables with tabs on a wide card", async () => {
    mount(RELATIONSHIP.transition());
    await screen.findByRole("table", { name: /Flow summary/ });
    const tabs = screen.getByRole("tablist", { name: "Table" });
    expect(within(tabs).getAllByRole("tab").map((x) => x.textContent)).toEqual(["Flow summary", "Matrix"]);
    expect(within(tabs).getByRole("tab", { selected: true })).toHaveTextContent("Flow summary");
  });
});
