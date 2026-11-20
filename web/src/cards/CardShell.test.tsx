import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GridPayload, StateContext } from "../api/types";
import { PAYLOADS, infoFor, stubCardApi } from "../test/cardApi";
import { renderWithProviders } from "../test/render";
import { CardShell } from "./CardShell";
import { cutLabel } from "./view";

const CTX: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["R1", "R2"], compare_round: "R1", anchor_round: "R2",
  version_mode: "extrapolated", geo_scope: "state",
};

afterEach(() => vi.unstubAllGlobals());

const mount = (p: GridPayload) => renderWithProviders(<CardShell info={infoFor(p)} ctx={CTX} />);
const posts = (f: ReturnType<typeof stubCardApi>) => f.mock.calls.filter(([, i]) => i?.method === "POST").length;

describe("CardShell", () => {
  it.each([
    ["distribution", PAYLOADS.distributionStandalone],
    ["opinion", PAYLOADS.opinionStandalone],
    ["gender_differential", PAYLOADS.genderStandalone],
  ])("renders the %s family from its fixture payload", async (family, make) => {
    const p = make();
    stubCardApi({ payloads: [p] });
    mount(p);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(p.family).toBe(family);
    expect(screen.getByRole("heading", { name: `Card ${p.card_id}` })).toBeInTheDocument();
  });

  it("shows the engine reason and no grid for an unavailable card, and never starts a run", async () => {
    const p = PAYLOADS.distributionStandalone();
    const f = stubCardApi({ payloads: [p], unavailable: { [p.card_id]: [{ part: "grid", reason: "Scenario 'LS' was not asked in R2" }] } });
    mount(p);
    expect(await screen.findByText(/Scenario 'LS' was not asked in R2/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(posts(f)).toBe(1); // the plan only
  });

  it("shows the error with a refresh button when the run fails to start", async () => {
    const p = PAYLOADS.distributionStandalone();
    stubCardApi({ payloads: [p], runStatus: 500 });
    mount(p);
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("changing lens, cut, transpose and format makes no extra requests", async () => {
    const p = PAYLOADS.distributionStandalone();
    const f = stubCardApi({ payloads: [p] });
    mount(p);
    await screen.findByRole("table");
    const before = f.mock.calls.length;
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Transpose/ }));
    await user.click(screen.getByRole("radio", { name: cutLabel(p.cuts[1].dimensions) }));
    await user.click(screen.getByRole("button", { name: /^Lens:/ }));
    await user.click(screen.getByRole("radio", { name: p.meta.lenses[1].label }));
    await user.click(screen.getByRole("button", { name: /^Format/ }));
    await user.click(screen.getByRole("radio", { name: "Heat on value" }));
    expect(f.mock.calls.length).toBe(before);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("footer shows per-round coverage and not-asked notes", async () => {
    const p = PAYLOADS.distributionStandalone();
    p.not_asked = [{ part: "grid", rounds: ["2027 VS CAPI R1"] }];
    p.coverage = [{ job: "grid", part: "grid", coverage: { excluded_by_observation: { R2: [5, 9] } } }];
    stubCardApi({ payloads: [p] });
    mount(p);
    const footer = await screen.findByTestId("card-footer");
    expect(footer).toHaveTextContent("2027 VS CAPI R2: 403 seats · Normal");
    expect(footer).toHaveTextContent("Not asked in 2027 VS CAPI R1");
    expect(footer).toHaveTextContent("2 seats excluded in 2027 VS CAPI R2");
  });

  it("subtitle uses series-qualified round names, bare labels only as sub-headers", async () => {
    const p = PAYLOADS.distributionCompare();
    stubCardApi({ payloads: [p] });
    mount(p);
    await screen.findByRole("table");
    expect(screen.getByTestId("card-subtitle")).toHaveTextContent(/^anchor round 2027 VS CAPI R2 · Δ vs 2027 VS CAPI R1$/);
    expect(within(await screen.findByRole("table")).getByText(/Δ vs 2027 VS CAPI R1/)).toBeInTheDocument();
  });

  it("names the reference from the card's own deltas, not the context compare round", async () => {
    const p = PAYLOADS.distributionCompare();
    for (const cut of p.cuts) for (const d of cut.deltas) d.reference = `${d.target.split(":")[0]}:ls_past`;
    stubCardApi({ payloads: [p] });
    mount(p);
    await screen.findByRole("table");
    expect(screen.getByTestId("card-subtitle")).toHaveTextContent(/^anchor round 2027 VS CAPI R2 · Δ vs ls_past$/);
  });

  it("opens the method drawer with the contract from the payload", async () => {
    const p = PAYLOADS.distributionStandalone();
    stubCardApi({ payloads: [p] });
    mount(p);
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: /How this was calculated/ }));
    const drawer = await screen.findByRole("dialog");
    await waitFor(() => expect(within(drawer).getByText("Contract")).toBeInTheDocument());
    expect(within(drawer).getByText(/Rounds/)).toBeInTheDocument();
  });

  describe("seat selector", () => {
    const SCOPES = { category: "seat", gender: "respondent", caste: "respondent" } as const;

    it("turns a seat field that comes first in a crossed cut into a selector and narrows the table", async () => {
      const p = PAYLOADS.distributionStandalone();
      const crossed = p.cuts.find((c) => c.dimensions.join() === "category,gender")!;
      const f = stubCardApi({ payloads: [p], fieldScopes: SCOPES });
      mount(p);
      const user = userEvent.setup();
      await screen.findByRole("table");
      await user.click(screen.getByRole("radio", { name: cutLabel(crossed.dimensions) }));
      const group = await screen.findByRole("group", { name: "category" });
      const genders = new Set(crossed.rows.map((r) => r.labels.gender));
      await waitFor(() => expect(screen.getAllByRole("rowheader")).toHaveLength(genders.size));
      const before = posts(f);
      const first = within(group).getAllByRole("button")[0].textContent;
      await user.click(within(group).getByRole("button", { name: "Next category" }));
      expect(within(screen.getByRole("group", { name: "category" })).getAllByRole("button")[0].textContent).not.toBe(first);
      expect(screen.getAllByRole("rowheader")).toHaveLength(genders.size);
      expect(posts(f)).toBe(before); // choosing a seat group is display only
    });

    it("shows no selector when the first field is a respondent field", async () => {
      const p = PAYLOADS.distributionStandalone();
      const crossed = p.cuts.find((c) => c.dimensions.join() === "category,gender")!;
      stubCardApi({ payloads: [p], fieldScopes: { category: "respondent", gender: "respondent" } });
      mount(p);
      await screen.findByRole("table");
      await userEvent.click(screen.getByRole("radio", { name: cutLabel(crossed.dimensions) }));
      expect(screen.queryByRole("group", { name: "category" })).toBeNull();
      expect(screen.getAllByRole("rowheader")).toHaveLength(crossed.rows.length);
    });
  });
});
