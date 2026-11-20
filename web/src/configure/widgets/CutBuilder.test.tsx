import { screen } from "@testing-library/react";
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
  await screen.findAllByRole("option", { name: "party_zone (seat)" }); // the field list has arrived
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
});
