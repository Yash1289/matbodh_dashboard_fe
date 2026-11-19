import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardConfigJson, CardFilterConfig, FieldDescriptor, StateContext } from "../../api/types";
import { renderWithProviders } from "../../test/render";
import { FilterList } from "./FilterList";

const CTX: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["R1", "R2"], compare_round: "R1", anchor_round: "R2",
  version_mode: "extrapolated", geo_scope: "state",
};
const FIELD: FieldDescriptor = {
  path: "filters", label: "Only respondents where", widget: "filter_list", required: false, tier: "more", multiple: false,
  options: { source: "fields", params: { use: "filter" } },
};
const DRAFT: CardConfigJson = { id: "d", family: "distribution", title: "T", scenarios: ["vs_voting_intention"] };

function stub(values: string[]) {
  const posts: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api/, "");
    const reply = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
    if (path === "/configure/options") {
      return reply(["caste", "gender"].map((v) => ({ value: v, label: v, kind: null, recalled: false, disabled_reason: null })));
    }
    if (path === "/configure/values") {
      posts.push(JSON.parse(String(init!.body)));
      return reply({ run_id: "vals" });
    }
    if (path === "/runs/vals") {
      return reply({ state: "done", done: 1, total: 1, errors: {}, result: { kind: "filter_values", field: "caste", values } });
    }
    return new Response("{}", { status: 404 });
  }));
  return posts;
}

afterEach(() => vi.unstubAllGlobals());

const mount = (value: CardFilterConfig[], onChange = vi.fn()) => {
  renderWithProviders(<FilterList field={FIELD} value={value} onChange={onChange} draft={DRAFT} ctx={CTX} />);
  return onChange;
};

describe("FilterList", () => {
  it("flags a chosen value missing from the current rounds", async () => {
    const posts = stub(["Brahmin", "Yadav"]);
    mount([{ field: "caste", operator: "in", values: ["Ghost", "Yadav"] }]);
    expect(await screen.findByRole("checkbox", { name: "Brahmin" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Yadav" })).toBeChecked();
    const ghost = screen.getByRole("checkbox", { name: /Ghost/ });
    expect(ghost).toBeChecked();
    expect(screen.getByText(/not in the selected rounds/)).toBeInTheDocument();
    expect(posts).toEqual([{ field: "caste", scenario: "vs_voting_intention", context: CTX, pipe_rounds: null }]);
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
});
