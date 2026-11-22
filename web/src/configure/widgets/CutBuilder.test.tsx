import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardConfigJson, FieldDescriptor, StateContext } from "../../api/types";
import { renderWithProviders } from "../../test/render";
import { CutBuilder } from "./CutBuilder";

const CTX: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["R1", "R2"], compare_round: "R1", anchor_round: "R2",
  version_mode: "extrapolated", geo_scope: "state",
};
const DRAFT: CardConfigJson = { id: "c", family: "distribution", title: "C" };
const FIELD: FieldDescriptor = {
  path: "cuts", label: "Split by", widget: "cut_builder", required: false, tier: "primary", multiple: false,
  options: { source: "fields", params: { use: "cut" } },
};
const opt = (value: string, scope: string, over: object = {}) =>
  ({ value, label: value, kind: null, recalled: false, disabled_reason: null, scope, ...over });
const OPTIONS = [opt("age_group", "respondent"), opt("gender", "respondent"), opt("party_zone", "seat"), opt("ac_num", "seat")];

afterEach(() => vi.unstubAllGlobals());

const show = async (cuts: string[][]) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(OPTIONS), { status: 200 })));
  const onChange = vi.fn();
  renderWithProviders(<CutBuilder field={FIELD} value={cuts} onChange={onChange} draft={DRAFT} ctx={CTX} />);
  // The field list has arrived once the picker offers more than its placeholder.
  await waitFor(() => expect(within(screen.getByRole("combobox", { name: "Add a split" })).getAllByRole("option").length).toBeGreaterThan(1));
  return onChange;
};
const optionsOf = (name: string) => within(screen.getByRole("combobox", { name })).getAllByRole("option").map((o) => o.textContent);
const choose = (name: string, value: string) => fireEvent.change(screen.getByRole("combobox", { name }), { target: { value } });

describe("View by seat attribute", () => {
  it("lists only seat fields, after a choice of none", async () => {
    await show([[]]);
    expect(optionsOf("View by seat")).toEqual(["All seats together", "party_zone", "ac_num"]);
  });

  it("puts the chosen seat attribute first in every table, keeping the nesting", async () => {
    const onChange = await show([[], ["age_group"], ["age_group", "gender"]]);
    choose("View by seat", "party_zone");
    expect(onChange).toHaveBeenCalledWith([
      ["party_zone"], ["party_zone", "age_group"], ["party_zone", "age_group", "gender"]]);
  });

  it("reads a saved seat-first card back as a View by, with no note about it", async () => {
    await show([["party_zone"], ["party_zone", "age_group"]]);
    expect(screen.getByRole("combobox", { name: "View by seat" })).toHaveValue("party_zone");
    expect(screen.queryByText(/is a seat field/)).toBeNull();
  });

  it("offers no seat field as a split while a View by is set", async () => {
    await show([["party_zone"], ["party_zone", "age_group"]]);
    expect(optionsOf("Add a split")).not.toContain("ac_num (seat)");
    expect(optionsOf("Add a split")).not.toContain("party_zone (seat)");
  });

  it("drops seat splits already added when a View by is chosen", async () => {
    const onChange = await show([[], ["ac_num"]]);
    choose("View by seat", "party_zone");
    expect(onChange).toHaveBeenCalledWith([["party_zone"]]);
  });

  it("clearing it removes the seat attribute from every table", async () => {
    const onChange = await show([["party_zone"], ["party_zone", "age_group"]]);
    choose("View by seat", "");
    expect(onChange).toHaveBeenCalledWith([[], ["age_group"]]);
  });
});

describe("splits", () => {
  it("groups the fields it offers, with seat fields as tables of their own", async () => {
    await show([[]]);
    const select = screen.getByRole("combobox", { name: "Add a split" });
    expect(select.querySelector('optgroup[label="Respondent fields"]')).not.toBeNull();
    expect(select.querySelector('optgroup[label="Seat fields"]')!.textContent).toContain("party_zone (seat)");
  });

  it("adds a table for a chosen field", async () => {
    const onChange = await show([[]]);
    choose("Add a split", "age_group");
    expect(onChange).toHaveBeenCalledWith([[], ["age_group"]]);
  });

  it("builds a nested item when a field is split further, adding its parent table too", async () => {
    const onChange = await show([["age_group"]]);
    choose("Then split age_group by", "gender");
    expect(onChange).toHaveBeenCalledWith([["age_group"], ["age_group", "gender"]]);
  });

  it("names the tables a nested item reads, and removes them together", async () => {
    const onChange = await show([["age_group"], ["age_group", "gender"]]);
    expect(screen.getByText("age_group › gender")).toBeInTheDocument();
    expect(screen.getByText(/age_group, age_group × gender/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove age_group › gender" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("gives a seat field on its own no way to be crossed", async () => {
    await show([[], ["party_zone"]]);
    expect(screen.queryByRole("combobox", { name: /Then split party_zone by/ })).toBeNull();
  });

  it("does not offer a field that already starts a split, or a cross that adds no table", async () => {
    await show([["gender"], ["age_group"], ["age_group", "gender"]]);
    expect(optionsOf("Add a split")).not.toContain("gender");
    expect(optionsOf("Add a split")).not.toContain("age_group");
    const nestedCross = optionsOf("Then split age_group › gender by");
    expect(nestedCross).not.toContain("gender");
    expect(nestedCross).not.toContain("age_group");
  });

  it("draws every split once, with no repeated key, when a saved card holds the same table twice", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    await show([["gender"], ["gender"]]);
    expect(screen.getAllByRole("combobox", { name: "Then split gender by" })).toHaveLength(1);
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/same key/i);
  });

  it("counts the tables the card will read", async () => {
    await show([[], ["age_group"], ["age_group", "gender"]]);
    expect(screen.getByText("3 tables")).toBeInTheDocument();
  });
});
