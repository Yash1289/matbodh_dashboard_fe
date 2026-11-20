import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardConfigJson, CardFilterConfig, FieldDescriptor, StateContext } from "../../api/types";
import { renderWithProviders } from "../../test/render";
import { FilterList, SLOW_MS } from "./FilterList";

const CTX: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["R1", "R2"], compare_round: "R1", anchor_round: "R2",
  version_mode: "extrapolated", geo_scope: "state",
};
const FIELD: FieldDescriptor = {
  path: "filters", label: "Only respondents where", widget: "filter_list", required: false, tier: "more", multiple: false,
  options: { source: "fields", params: { use: "filter" } },
};
const DRAFT: CardConfigJson = { id: "d", family: "distribution", title: "T", scenarios: ["vs_voting_intention"] };

function stub(values: string[], state: "done" | "failed" | "rejected" | "running" = "done", lookup?: string[]) {
  const posts: unknown[] = [];
  const lookups: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api/, "");
    const reply = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
    if (path === "/configure/options") {
      return reply(["caste", "gender"].map((v) => ({ value: v, label: v, kind: null, recalled: false, disabled_reason: null })));
    }
    if (path === "/configure/values/distinct") {
      lookups.push(JSON.parse(String(init!.body)));
      if (state === "rejected") {
        return new Response(JSON.stringify({ valid: false, errors: ["Field 'caste' needs to exist in every included round; missing in: R1"] }), { status: 422 });
      }
      // Without a lookup the field is one the engine run has to list.
      return reply({ kind: "filter_values", field: "caste", values: lookup ?? [], source: lookup ? "responses" : "engine" });
    }
    if (path === "/configure/values" && state === "rejected") {
      return new Response(JSON.stringify({ valid: false, errors: ["Field 'caste' needs to exist in every included round; missing in: R1"] }), { status: 422 });
    }
    if (path === "/configure/values") {
      posts.push(JSON.parse(String(init!.body)));
      return reply({ run_id: "vals" });
    }
    if (path === "/runs/vals" && state === "running") return reply({ state: "running", done: 0, total: 1, result: null, errors: {} });
    if (path === "/runs/vals") {
      if (state === "failed") {
        return reply({ state, done: 1, total: 1, result: null,
          errors: { values: { kind: "config", message: "Field 'caste' is missing in R1", fingerprint: null, jobs: ["values"] } } });
      }
      return reply({ state: "done", done: 1, total: 1, errors: {}, result: { kind: "filter_values", field: "caste", values } });
    }
    return new Response("{}", { status: 404 });
  }));
  return Object.assign(posts, { lookups });
}

afterEach(() => vi.unstubAllGlobals());

const mount = (value: CardFilterConfig[], onChange = vi.fn()) => {
  renderWithProviders(<FilterList field={FIELD} value={value} onChange={onChange} draft={DRAFT} ctx={CTX} />);
  return onChange;
};

describe("FilterList", () => {
  it("lists the lookup's values at once, with no engine run, for the rounds the card's mode reads", async () => {
    const posts = stub([], "done", ["10th Pass", "8th Pass"]);
    renderWithProviders(<FilterList field={FIELD} value={[{ field: "caste", operator: "in", values: [] }]} onChange={vi.fn()}
      draft={{ ...DRAFT, comparison: { mode: "compare" } }} ctx={CTX} />);
    expect(await screen.findByRole("checkbox", { name: "10th Pass" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "8th Pass" })).toBeInTheDocument();
    expect([...posts]).toEqual([]); // no run was started
    expect(posts.lookups).toEqual([{ field: "caste", mode: "compare", context: CTX, pipe_rounds: null }]);
  });

  it("asks for a standalone card's rounds when the card has no comparison", async () => {
    const posts = stub(["Yadav"]);
    mount([{ field: "caste", operator: "in", values: [] }]);
    expect(await screen.findByRole("checkbox", { name: "Yadav" })).toBeInTheDocument(); // the engine run answered
    expect(posts.lookups).toEqual([{ field: "caste", mode: "standalone", context: CTX, pipe_rounds: null }]);
  });

  it("says a first load can take about a minute once it has waited a few seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stub([], "running");
      mount([{ field: "qualification", operator: "in", values: [] }]);
      expect(await screen.findByText("Loading values…")).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(SLOW_MS + 100); });
      expect(screen.getByText(/Still loading.*about a minute/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the API's reason when a field's values cannot be listed (422), keeping the chosen values", async () => {
    stub([], "rejected");
    mount([{ field: "caste", operator: "in", values: ["Yadav"] }]);
    expect(await screen.findByText(/needs to exist in every included round; missing in: R1/)).toBeInTheDocument();
    expect(screen.queryByText("The values could not be loaded")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Yadav" })).toBeChecked();
  });

  it("flags a chosen value missing from the current rounds", async () => {
    const posts = stub(["Brahmin", "Yadav"]);
    mount([{ field: "caste", operator: "in", values: ["Ghost", "Yadav"] }]);
    expect(await screen.findByRole("checkbox", { name: "Brahmin" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Yadav" })).toBeChecked();
    const ghost = screen.getByRole("checkbox", { name: /Ghost/ });
    expect(ghost).toBeChecked();
    expect(screen.getByText(/not in the selected rounds/)).toBeInTheDocument();
    expect([...posts]).toEqual([{ field: "caste", scenario: "vs_voting_intention", context: CTX, pipe_rounds: null }]);
  });

  it("adds a filter for a field and toggles values", async () => {
    stub(["Brahmin", "Yadav"]);
    const onChange = mount([]);
    const add = await screen.findByRole("combobox", { name: "Add filter" });
    await screen.findByRole("option", { name: "caste" });
    await userEvent.selectOptions(add, "caste");
    expect(onChange).toHaveBeenLastCalledWith([{ field: "caste", operator: "in", values: [] }]);
  });

  it("toggling a value and switching the operator report the new filter list", async () => {
    stub(["Brahmin", "Yadav"]);
    const onChange = mount([{ field: "caste", operator: "in", values: ["Yadav"] }]);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Brahmin" }));
    expect(onChange).toHaveBeenLastCalledWith([{ field: "caste", operator: "in", values: ["Yadav", "Brahmin"] }]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "caste" }), "not_in");
    expect(onChange).toHaveBeenLastCalledWith([{ field: "caste", operator: "not_in", values: ["Yadav"] }]);
  });

  it("a failed values run says so instead of loading forever", async () => {
    stub([], "failed");
    mount([{ field: "caste", operator: "in", values: ["Yadav"] }]);
    expect(await screen.findByText(/Field 'caste' is missing in R1/)).toBeInTheDocument();
    expect(screen.queryByText("Loading values…")).toBeNull();
    expect(screen.getByRole("checkbox", { name: /Yadav/ })).toBeChecked(); // the chosen value is still shown
  });
});
