import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CohortPreview, StateContext } from "../api/types";
import { RANKED, stubCardApi } from "../test/cardApi";
import { renderWithProviders } from "../test/render";
import { _dropMemory, clearCohort } from "./cohortStore";
import { CohortDialog } from "./CohortDialog";

const CTX: StateContext = {
  state: "Uttar Pradesh", level: "ac", rounds: ["R1", "R2"], compare_round: "R1", anchor_round: "R2",
  version_mode: "extrapolated", geo_scope: "state",
  cohort: { seat_level: "ac", seat_ids: [9], label: "Earlier", created_at: "2026-11-18T00:00:00Z" },
};
const PREVIEW: CohortPreview = { kind: "cohort_preview", seat_level: "ac", seat_ids: [3, 12, 57], count: 3 };

afterEach(() => {
  clearCohort("Uttar Pradesh");
  _dropMemory();
  vi.unstubAllGlobals();
});

const mount = (over: Partial<Parameters<typeof CohortDialog>[0]> = {}) => {
  const onClose = vi.fn();
  const api = stubCardApi({ payloads: [RANKED.seatStandalone()], preview: PREVIEW });
  renderWithProviders(<CohortDialog opened onClose={onClose} card={{ card_id: "ranking.test" }} kind="ranking" ctx={CTX}
    reference={null} hasReference={false} cardTitle="AC ranking" {...over} />);
  return { onClose, api };
};

const postBodies = (api: ReturnType<typeof stubCardApi>) =>
  api.mock.calls.filter(([, init]) => init?.method === "POST").map(([url, init]) => [String(url), JSON.parse(String(init!.body))]);

describe("CohortDialog", () => {
  it("previews a ranking selection and uses the seat list as the session cohort", async () => {
    const { api, onClose } = mount();
    expect(screen.getByRole("button", { name: "Find seats" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Top N in each group" }), "5");
    await userEvent.click(screen.getByRole("button", { name: "Find seats" }));
    expect(await screen.findByText("3 seats matched")).toBeInTheDocument();
    const [url, body] = postBodies(api).find(([u]) => u === "/api/cohorts/preview")!;
    expect(url).toBe("/api/cohorts/preview");
    expect(body.card_id).toBe("ranking.test");
    expect(body.predicate).toEqual({ rank_max: 5 });
    expect(body.context.cohort).toBeNull(); // selecting seats never starts from an earlier cohort
    await userEvent.click(screen.getByRole("button", { name: "Use as cohort" }));
    expect(onClose).toHaveBeenCalled();
    const { getCohort } = await import("./cohortStore");
    expect(getCohort("Uttar Pradesh")).toMatchObject({ seat_level: "ac", seat_ids: [3, 12, 57] });
    expect(getCohort("Uttar Pradesh")!.label).toContain("AC ranking");
  });

  it("an empty selection cannot be used", async () => {
    stubCardApi({ payloads: [], preview: { ...PREVIEW, seat_ids: [], count: 0 } });
    renderWithProviders(<CohortDialog opened onClose={vi.fn()} card={{ card_id: "ranking.test" }} kind="ranking" ctx={CTX}
      reference={null} hasReference={false} cardTitle="AC ranking" />);
    await userEvent.type(screen.getByRole("textbox", { name: "Top N in each group" }), "5");
    await userEvent.click(screen.getByRole("button", { name: "Find seats" }));
    expect(await screen.findByText("No seats matched")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use as cohort" })).toBeDisabled();
  });

  it("a benchmark offers flip only when the card has a reference", async () => {
    mount({ kind: "benchmark", hasReference: false });
    expect(screen.queryByLabelText("Flip")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
  });

  it("a benchmark with a reference sends flip, endpoint and margins", async () => {
    const { api } = mount({ kind: "benchmark", hasReference: true, reference: { kind: "compare" } as never });
    await userEvent.selectOptions(screen.getByLabelText("Flip"), "gain");
    await userEvent.click(screen.getByRole("button", { name: "Find seats" }));
    await screen.findByText("3 seats matched");
    const [, body] = postBodies(api).find(([u]) => u === "/api/cohorts/preview")!;
    expect(body.predicate).toEqual({ flip: "gain" });
    expect(body.reference).toEqual({ kind: "compare" });
  });

  it("shows the reason when the card cannot make a cohort", async () => {
    stubCardApi({ payloads: [], previewError: "A demographic ranking cannot supply a seat set" });
    renderWithProviders(<CohortDialog opened onClose={vi.fn()} card={{ card_id: "ranking.demo" }} kind="ranking" ctx={CTX}
      reference={null} hasReference={false} cardTitle="Demo" />);
    await userEvent.type(screen.getByRole("textbox", { name: "Top N in each group" }), "3");
    await userEvent.click(screen.getByRole("button", { name: "Find seats" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("demographic ranking cannot supply"));
  });

  it("shows what the cohort is taken from, read-only, before the rule", () => {
    mount({ cardTitle: "AC ranking", kind: "benchmark", hasReference: true, reference: null });
    const source = screen.getByTestId("cohort-source");
    expect(source).toHaveTextContent("Taken from this card");
    expect(source).toHaveTextContent("AC ranking");
    expect(within(source).queryByRole("textbox")).toBeNull();
  });

  it("says that seats tied at the cut-off are included in a ranking rule", () => {
    mount();
    expect(screen.getByText(/tied at the cut-off are included/i)).toBeInTheDocument();
  });

  it("lists the matched seats and keeps Use as cohort off until seats are found", async () => {
    mount();
    expect(screen.getByRole("button", { name: "Use as cohort" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Top N in each group" }), "5");
    await userEvent.click(screen.getByRole("button", { name: "Find seats" }));
    await screen.findByText("3 seats matched");
    expect(screen.getByTestId("cohort-seats")).toHaveTextContent("AC 3, 12, 57");
    expect(screen.getByRole("button", { name: "Use as cohort" })).toBeEnabled();
  });
});
