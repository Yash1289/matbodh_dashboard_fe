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
