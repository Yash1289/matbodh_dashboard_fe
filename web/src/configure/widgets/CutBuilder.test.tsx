import { screen, waitFor, within } from "@testing-library/react";
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
  renderWithProviders(<CutBuilder field={FIELD} value={cuts} onChange={vi.fn()} draft={DRAFT} ctx={CTX} />);
  // The field list has arrived once the picker offers more than its placeholder.
  await waitFor(() => expect(within(screen.getByRole("combobox", { name: "Add a cut" })).getAllByRole("option").length).toBeGreaterThan(1));
};

describe("CutBuilder", () => {
  it("groups the fields it offers by what they describe and marks the seat ones", async () => {
    await show([]);
    const select = screen.getByRole("combobox", { name: "Add a cut" });
    expect(select.querySelector('optgroup[label="Respondent fields"]')).not.toBeNull();
    const seat = select.querySelector('optgroup[label="Seat fields"]')!;
    expect(seat.textContent).toContain("party_zone (seat)");
  });

  it("explains that a seat field first in a crossed cut becomes a selector", async () => {
    await show([["party_zone", "gender"]]);
    expect(screen.getByText(/party_zone is a seat field/)).toBeInTheDocument();
  });

  it.each([[[["gender", "party_zone"]]], [[["party_zone"]]], [[["age_group", "gender"]]]])(
    "gives no seat note for %j", async (cuts) => {
      await show(cuts);
      expect(screen.queryByText(/is a seat field/)).toBeNull();
    });

  it("does not offer a field that already is a cut by itself, or a cross that repeats a cut", async () => {
    await show([["gender"], ["age_group", "party_zone"]]);
    const add = screen.getByRole("combobox", { name: "Add a cut" });
    expect(within(add).queryByRole("option", { name: "gender" })).toBeNull();
    expect(within(add).getByRole("option", { name: "age_group" })).toBeInTheDocument();
    // [gender] crossed with age_group would be a table the card already has only if [age_group, gender] existed.
    const cross = screen.getByRole("combobox", { name: "Cross gender with" });
    expect(within(cross).getByRole("option", { name: "age_group" })).toBeInTheDocument();
    expect(within(cross).queryByRole("option", { name: "gender" })).toBeNull();
  });

  it("does not offer a cross that would repeat another cut's fields", async () => {
    await show([["age_group"], ["gender", "age_group"]]);
    const cross = screen.getByRole("combobox", { name: "Cross age_group with" });
    expect(within(cross).queryByRole("option", { name: "gender" })).toBeNull();
  });

  it("draws every cut once, with no repeated key, when a saved card holds the same cut twice", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    await show([["gender"], ["gender"]]);
    expect(screen.getAllByRole("combobox", { name: "Cross gender with" })).toHaveLength(2);
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/same key/i);
  });
});
