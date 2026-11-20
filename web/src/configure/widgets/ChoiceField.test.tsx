import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardConfigJson, FieldDescriptor, StateContext } from "../../api/types";
import { renderWithProviders } from "../../test/render";
import { ChoiceField } from "./ChoiceField";

const CTX: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["R1", "R2"], compare_round: "R1", anchor_round: "R2",
  version_mode: "extrapolated", geo_scope: "state",
};
const DRAFT: CardConfigJson = { id: "b", family: "seat_benchmark", title: "B" };
const field = (multiple: boolean): FieldDescriptor => ({
  path: multiple ? "benchmark.contenders" : "benchmark.focal_party", label: multiple ? "Parties shown" : "Focal party",
  widget: "party_picker", required: false, tier: "more", multiple, options: { source: "parties", params: { use: "contenders" } },
});

afterEach(() => vi.unstubAllGlobals());

const stubOptions = (values: string[]) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(
  values.map((v) => ({ value: v, label: v, kind: null, recalled: false, disabled_reason: null }))), { status: 200 })));

describe("ChoiceField with values the lists no longer offer", () => {
  it("a chosen value that is no longer offered stays visible and can be unticked", async () => {
    stubOptions(["NDA", "SP+"]); // after a reference change, XYZ is no longer a major party
    const onChange = vi.fn();
    renderWithProviders(<ChoiceField field={field(true)} value={["NDA", "XYZ"]} onChange={onChange} draft={DRAFT} ctx={CTX} />);
    const stale = await screen.findByRole("checkbox", { name: "XYZ (no longer available)" });
    expect(stale).toBeChecked();
    await userEvent.click(stale);
    expect(onChange).toHaveBeenLastCalledWith(["NDA"]);
  });

  it("a single select keeps showing its value when the list no longer offers it", async () => {
    stubOptions(["NDA", "SP+"]);
    renderWithProviders(<ChoiceField field={field(false)} value="XYZ" onChange={vi.fn()} draft={DRAFT} ctx={CTX} />);
    const select = await screen.findByRole("combobox", { name: "Focal party" });
    expect(await within(select).findByRole("option", { name: "XYZ (no longer available)" })).toBeInTheDocument();
    expect(select).toHaveValue("XYZ");
  });
});

const scenarioField = (multiple: boolean): FieldDescriptor => ({
  path: "comparison.reference.scenario", label: "Compared with", widget: "scenario_picker", required: true, tier: "primary", multiple,
  options: { source: "scenarios", params: { kind: "any" } },
});
const stubItems = (items: object[]) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(items), { status: 200 })));
const item = (value: string, kind: string | null, over: object = {}) =>
  ({ value, label: value, kind, recalled: false, disabled_reason: null, ...over });

describe("ChoiceField option lists", () => {
  it("groups questions by kind and marks recalled ones", async () => {
    stubItems([item("vs_voting_intention", "party"), item("vs_past", "party", { recalled: true }), item("pm_satisfaction", "opinion")]);
    renderWithProviders(<ChoiceField field={scenarioField(false)} value="" onChange={vi.fn()} draft={DRAFT} ctx={CTX} />);
    const select = await screen.findByRole("combobox", { name: /Compared with/ });
    await within(select).findByRole("option", { name: "vs_past (recalled)" });
    expect(within(select).getByRole("group", { name: "Party questions" })).toBeInTheDocument();
    expect(within(select).getByRole("group", { name: "Opinion questions" })).toBeInTheDocument();
    expect(within(within(select).getByRole("group", { name: "Opinion questions" })).getByRole("option", { name: "pm_satisfaction" })).toBeInTheDocument();
  });

  it("greys an unavailable option with its reason so it cannot be picked", async () => {
    stubItems([item("vs_voting_intention", "party"), item("mla_choice_party", "party", { disabled_reason: "Not asked in 2027 VS CAPI R3" })]);
    renderWithProviders(<ChoiceField field={scenarioField(false)} value="" onChange={vi.fn()} draft={DRAFT} ctx={CTX} />);
    const select = await screen.findByRole("combobox", { name: /Compared with/ });
    const option = await within(select).findByRole("option", { name: "mla_choice_party (Not asked in 2027 VS CAPI R3)" });
    expect(option).toBeDisabled();
  });

  it("groups and marks the check boxes of a multiple list too, and a disabled one stays off", async () => {
    stubItems([item("vs_voting_intention", "party"), item("vs_past", "party", { recalled: true }), item("pm_satisfaction", "opinion", { disabled_reason: "Not asked in R3" })]);
    const onChange = vi.fn();
    renderWithProviders(<ChoiceField field={scenarioField(true)} value={[]} onChange={onChange} draft={DRAFT} ctx={CTX} />);
    expect(await screen.findByText("Party questions")).toBeInTheDocument();
    expect(screen.getByText("Opinion questions")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "vs_past (recalled)" })).toBeInTheDocument();
    const off = screen.getByRole("checkbox", { name: "pm_satisfaction (Not asked in R3)" });
    expect(off).toBeDisabled();
    await userEvent.click(off);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ChoiceField on the scenarios list", () => {
  // CardConfig.scenarios is a list on the backend even where the card takes one question (ranking, benchmark),
  // so a single select there must store a one-item list, never a bare string ("Input should be a valid list").
  const questionField: FieldDescriptor = {
    path: "scenarios", label: "Question", widget: "scenario_picker", required: true, tier: "primary", multiple: false,
    options: { source: "scenarios", params: { kind: "any" } },
  };

  it("choosing a question stores it as a one-item list", async () => {
    stubItems([item("vs_voting_intention", "party"), item("pm_satisfaction", "opinion")]);
    const onChange = vi.fn();
    renderWithProviders(<ChoiceField field={questionField} value={[]} onChange={onChange} draft={DRAFT} ctx={CTX} />);
    const select = await screen.findByRole("combobox", { name: /Question/ });
    await within(select).findByRole("option", { name: "pm_satisfaction" });
    await userEvent.selectOptions(select, "pm_satisfaction");
    expect(onChange).toHaveBeenLastCalledWith(["pm_satisfaction"]);
  });

  it("shows the stored one-item list as the chosen question", async () => {
    stubItems([item("vs_voting_intention", "party"), item("pm_satisfaction", "opinion")]);
    renderWithProviders(<ChoiceField field={questionField} value={["pm_satisfaction"]} onChange={vi.fn()} draft={DRAFT} ctx={CTX} />);
    const select = await screen.findByRole("combobox", { name: /Question/ });
    await within(select).findByRole("option", { name: "pm_satisfaction" });
    expect(select).toHaveValue("pm_satisfaction");
  });

  it("other single selects keep storing a plain string", async () => {
    stubItems([item("vs_voting_intention", "party"), item("pm_satisfaction", "opinion")]);
    const onChange = vi.fn();
    renderWithProviders(<ChoiceField field={scenarioField(false)} value="" onChange={onChange} draft={DRAFT} ctx={CTX} />);
    const select = await screen.findByRole("combobox", { name: /Compared with/ });
    await within(select).findByRole("option", { name: "pm_satisfaction" });
    await userEvent.selectOptions(select, "pm_satisfaction");
    expect(onChange).toHaveBeenLastCalledWith("pm_satisfaction");
  });
});
