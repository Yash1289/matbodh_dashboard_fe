import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardConfigJson, OptionItem, StateContext, ValidateResponse } from "../api/types";
import families from "../test/fixtures/configure_families.json";
import { renderWithProviders } from "../test/render";
import { ConfigurePanel } from "./ConfigurePanel";

const CTX: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["R1", "R2"], compare_round: "R1", anchor_round: "R2",
  version_mode: "extrapolated", geo_scope: "state",
};
const opt = (value: string, kind: string | null = null, recalled = false): OptionItem =>
  ({ value, label: value, kind, recalled, disabled_reason: null });
const OPTIONS: Record<string, OptionItem[]> = {
  scenarios: [opt("vs_voting_intention", "party"), opt("vs_past", "party", true), opt("pm_satisfaction", "opinion")],
  fields: [opt("age_group"), opt("caste"), opt("gender")],
  parties: [opt("NDA"), opt("SP+"), opt("Other")],
};
const ok = (over: Partial<ValidateResponse> = {}): ValidateResponse =>
  ({ valid: true, errors: [], unavailable: [], not_asked: [], notes: [], rounds: [], ...over });

type Validator = (card: CardConfigJson) => ValidateResponse;

function stub(validate: Validator = () => ok()) {
  const sent: CardConfigJson[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const reply = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
    if (path === "/configure/families") return reply(families);
    if (path === "/configure/options") {
      const items = OPTIONS[body.source] ?? [];
      // Scenario lists honour the kind asked for, like the backend.
      return reply(body.source === "scenarios" && body.params.kind && body.params.kind !== "any"
        ? items.filter((i) => i.kind === body.params.kind) : items);
    }
    if (path === "/cards/validate") {
      sent.push(body.card);
      return reply(validate(body.card));
    }
    return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
  });
  vi.stubGlobal("fetch", mock);
  return { sent };
}

afterEach(() => vi.unstubAllGlobals());

const BASE: CardConfigJson = { id: "mine.1", family: "distribution", title: "Mine" };

function mount(initial: CardConfigJson = BASE, onApply = vi.fn()) {
  renderWithProviders(<ConfigurePanel family={initial.family} initial={initial} ctx={CTX} onApply={onApply} onCancel={vi.fn()} />);
  return { onApply };
}

describe("ConfigurePanel", () => {
  it("shows only primary fields first", async () => {
    stub();
    mount();
    expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("Mine");
    expect(await screen.findByText("Questions")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Show" })).toBeInTheDocument();
    expect(screen.getByText("Split by")).toBeInTheDocument();
    expect(screen.queryByText("Only respondents where")).not.toBeInTheDocument();
    expect(screen.queryByText("Show only these parties")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Compared with" })).not.toBeInTheDocument(); // compare only
  });

  it("Enter in the title applies a valid card, and does nothing while the card cannot run", async () => {
    stub();
    const { onApply } = mount();
    const title = await screen.findByRole("textbox", { name: "Title" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled());
    await userEvent.type(title, "{Enter}");
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("Enter does not apply while validation reports a problem", async () => {
    stub(() => ok({ valid: false, errors: [{ path: "scenarios", message: "Choose a question" }] }));
    const { onApply } = mount();
    const title = await screen.findByRole("textbox", { name: "Title" });
    await screen.findByRole("button", { name: "1 thing to fix" });
    await userEvent.type(title, "{Enter}");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("the status names what to fix and takes you to the first field with a problem", async () => {
    stub(() => ok({ valid: false, errors: [{ path: "title", message: "Give the card a title" }] }));
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "1 thing to fix" }));
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveFocus();
  });

  it("keeps one sentence of what the card will show next to Apply, and updates it as questions are chosen", async () => {
    stub();
    mount();
    const none = await screen.findByRole("checkbox", { name: "vs_voting_intention" });
    expect(screen.queryByTestId("draft-summary")).toBeNull(); // nothing chosen yet: nothing claimed
    await userEvent.click(none);
    expect(await screen.findByTestId("draft-summary")).toHaveTextContent("Shows vs_voting_intention in R2");
  });

  it("More options reveals the rest", async () => {
    stub();
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "More options" }));
    expect(await screen.findByText("Only respondents where")).toBeInTheDocument();
    expect(screen.getByText("Show only these parties")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Rounds to show" })).not.toBeInTheDocument(); // trend only
  });

  it("caste clubbing appears when caste is added to a cut", async () => {
    stub();
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "More options" }));
    expect(screen.queryByRole("checkbox", { name: "Club small castes" })).not.toBeInTheDocument();
    const addCut = await screen.findByRole("combobox", { name: "Add a cut" });
    await waitFor(() => expect(within(addCut).getByRole("option", { name: "caste" })).toBeInTheDocument());
    await userEvent.selectOptions(addCut, "caste");
    expect(await screen.findByRole("checkbox", { name: "Club small castes" })).toBeInTheDocument();
  });

  it("Shakti label when party target and opinion reference", async () => {
    stub();
    mount({ ...BASE, comparison: { mode: "compare" } });
    const question = await screen.findByRole("combobox", { name: "Question" });
    await waitFor(() => expect(within(question).getByRole("option", { name: "vs_voting_intention" })).toBeInTheDocument());
    await userEvent.selectOptions(question, "vs_voting_intention");
    const reference = screen.getByRole("combobox", { name: "Compared with" });
    await waitFor(() => expect(within(reference).getByRole("option", { name: "pm_satisfaction" })).toBeInTheDocument());
    await userEvent.selectOptions(reference, "pm_satisfaction");
    expect(await screen.findByText("Shakti comparison")).toBeInTheDocument();
  });

  it("shows field errors by path, and card-level problems in the summary", async () => {
    stub(() => ok({
      valid: false, errors: [{ path: "title", message: "title is at most 200 characters" }, { path: "", message: "card-wide problem" }],
      unavailable: [{ reason: "Scenario 'x' was not asked in R1" }], notes: ["showing 2 of the 3 rounds asked for"],
    }));
    mount();
    expect(await screen.findByText("title is at most 200 characters")).toBeInTheDocument();
    expect(screen.getByText("card-wide problem")).toBeInTheDocument();
    expect(screen.getByText("Scenario 'x' was not asked in R1")).toBeInTheDocument();
    expect(screen.getByText("showing 2 of the 3 rounds asked for")).toBeInTheDocument();
  });

  it("Apply disabled while invalid and calls onApply with the pruned draft", async () => {
    stub((card) => ok({ valid: (card.scenarios ?? []).length > 0 }));
    // A stale compare endpoint from an earlier edit must not survive into the applied card.
    const { onApply } = mount({ ...BASE, comparison: { mode: "standalone", target: { scenario: "pm_satisfaction" } } });
    const apply = await screen.findByRole("button", { name: "Apply" });
    await waitFor(() => expect(apply).toBeDisabled());
    await userEvent.click(await screen.findByRole("checkbox", { name: "vs_voting_intention" }));
    await waitFor(() => expect(apply).toBeEnabled());
    await userEvent.click(apply);
    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0][0] as CardConfigJson;
    expect(applied.scenarios).toEqual(["vs_voting_intention"]);
    expect(applied.comparison).toEqual({ mode: "standalone" });
    expect(applied.cuts).toEqual([[]]); // visible defaults are written, so the backend reads what was shown
  });

  it("validation is debounced", async () => {
    const { sent } = stub();
    mount();
    const title = await screen.findByRole("textbox", { name: "Title" });
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    await userEvent.type(title, "xyz");
    await waitFor(() => expect(sent[sent.length - 1]?.title).toBe("Minexyz"));
    expect(sent.some((c) => c.title === "Minex" || c.title === "Minexy")).toBe(false);
  });

  it("does not drop values hidden only because the scenario list is still loading", async () => {
    stub();
    const onApply = vi.fn();
    const initial: CardConfigJson = {
      id: "r", family: "relationship", title: "R",
      relationship: { origin: "vs_past", destination: "vs_voting_intention", include_recalled: { origin: ["Did Not Vote"] } },
    };
    mount(initial, onApply);
    const apply = await screen.findByRole("button", { name: "Apply" });
    await waitFor(() => expect(apply).toBeEnabled());
    await userEvent.click(apply);
    const applied = onApply.mock.calls[0][0] as CardConfigJson;
    expect(applied.relationship?.include_recalled).toEqual({ origin: ["Did Not Vote"] });
  });

  it("groups the compare fields in one tinted block, only when comparing", async () => {
    stub();
    mount({ ...BASE, comparison: { mode: "compare" } });
    const block = await screen.findByTestId("compare-block");
    expect(block).toHaveTextContent("Comparing two questions");
    expect(within(block).getByText("Question")).toBeInTheDocument();
    expect(within(block).getByText("Compared with")).toBeInTheDocument();
  });

  it("has no compare block while standalone", async () => {
    stub();
    mount();
    await screen.findByRole("button", { name: "Apply" });
    expect(screen.queryByTestId("compare-block")).toBeNull();
  });

  it("says how many More options are set, beside the button", async () => {
    stub();
    mount({ ...BASE, display_parties: ["NDA"] });
    expect(await screen.findByTestId("more-count")).toHaveTextContent("1 set");
  });

  it("starts at 0 set, and the footer says Ready to apply when the card is valid", async () => {
    stub();
    mount();
    expect(await screen.findByTestId("more-count")).toHaveTextContent("0 set");
    expect(await screen.findByText("Ready to apply")).toBeInTheDocument();
  });

  it("counts what is wrong in the footer and keeps Apply off", async () => {
    stub(() => ok({ valid: false, errors: [{ path: "title", message: "Enter a title" }] }));
    mount();
    expect(await screen.findByText("1 thing to fix")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  describe("every family", () => {
    const descriptors = families as unknown as { family: string; label: string; fields: { path: string; label: string; tier: string; show_when?: unknown; choices?: string[] }[] }[];

    it.each(descriptors.map((d) => [d.family] as const))("%s renders its unconditional primary fields in descriptor order, with nothing set", async (name) => {
      stub((card) => ok({ valid: Boolean(card.title) }));
      const d = descriptors.find((x) => x.family === name)!;
      mount({ id: "mine.1", family: name, title: "" } as CardConfigJson);
      expect(await screen.findByTestId("more-count")).toHaveTextContent(/[0-9] set/);
      const labels = d.fields.filter((f) => f.tier === "primary" && f.show_when === undefined).map((f) => f.label);
      expect(labels.length).toBeGreaterThan(0);
      let last = -1;
      for (const label of labels) {
        const found = screen.getAllByText(label, { exact: false });
        expect(found.length, label).toBeGreaterThan(0);
        const at = document.body.textContent!.indexOf(label);
        expect(at, `${label} comes after the previous field`).toBeGreaterThan(last);
        last = at;
      }
      // Apply stays off until the required title is filled in.
      expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    });

    it("gender gap offers no Compare, and seat ranking asks for a party only for a party metric", async () => {
      stub();
      const gender = descriptors.find((d) => d.family === "gender_differential")!;
      expect(gender.fields.find((f) => f.path === "comparison.mode")!.choices).not.toContain("compare");
      mount({ id: "mine.2", family: "seat_ranking", title: "Seats" } as CardConfigJson);
      await screen.findByTestId("more-count");
      expect(screen.queryByText("Party", { exact: true })).toBeNull();
    });
  });

  it("counts an unavailable card as something to fix, never a status stuck on Checking", async () => {
    stub(() => ok({ valid: false, errors: [], unavailable: [{ reason: "Scenario 'x' was not asked in R1" }] }));
    mount();
    expect(await screen.findByText("1 thing to fix")).toBeInTheDocument();
    expect(screen.queryByText("Checking…")).toBeNull();
  });
});
