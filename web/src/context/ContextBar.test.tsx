import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SurveysResponse } from "../api/types";
import plan from "../test/fixtures/plan_scoreboard.json";
import states from "../test/fixtures/states.json";
import surveysJson from "../test/fixtures/surveys.json";
import { renderWithProviders } from "../test/render";
import { ContextBar } from "./ContextBar";
import { ContextStep } from "./ContextStep";
import { parseContext } from "./urlContext";
import { useLocation, useNavigate } from "react-router-dom";

const surveys = surveysJson as unknown as SurveysResponse;
const R1 = "2027 VS CAPI R1";
const R2 = "2027 VS CAPI R2";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubApi(opts: { surveys?: SurveysResponse; planResponse?: Response; states?: string[] } = {}) {
  const fetchMock = vi.fn((url: string) => {
    if (url.endsWith("/catalogue/states")) return Promise.resolve(json(opts.states ? { states: opts.states } : states));
    if (url.endsWith("/surveys")) return Promise.resolve(json(opts.surveys ?? surveys));
    if (url.endsWith("/cards/plan")) return Promise.resolve(opts.planResponse ?? json(plan));
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function Probe() {
  return <div data-testid="search">{useLocation().search}</div>;
}
const renderStep = () => renderWithProviders(<><ContextBar /><ContextStep /><Probe /></>, { route: "/" });
const renderBar = (route = "/") => renderWithProviders(<><ContextBar /><Probe /></>, { route });
const URL_CTX = `/?state=Uttar+Pradesh&level=ac&rounds=${encodeURIComponent(R1)}&rounds=${encodeURIComponent(R2)}&compare=${encodeURIComponent(R1)}`;

afterEach(() => vi.unstubAllGlobals());

async function chooseLevel(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await screen.findByRole("textbox", { name: "Survey level" }));
  await user.click(await screen.findByRole("option", { name }));
}

describe("ContextBar", () => {
  it("with no context the bar shows no dialog and no Edit button; the step owns the choice", async () => {
    const fetchMock = stubApi();
    renderBar();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit context" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("context-pill")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/cards/run"))).toBe(false);
  });

  it("going back to an empty URL drops the context pill and Edit button without opening a dialog", async () => {
    stubApi();
    const user = userEvent.setup();
    function Clear() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate("/")}>clear url</button>;
    }
    renderWithProviders(<><ContextBar /><Clear /></>, { route: URL_CTX });
    await screen.findByRole("button", { name: "Edit context" });
    await user.click(screen.getByRole("button", { name: "clear url" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Edit context" })).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("every level the catalogue has is listed, none it lacks", async () => {
    stubApi();
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole("textbox", { name: "Survey level" }));
    expect(await screen.findByRole("option", { name: /^Zone/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^Assembly constituency/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^Parliamentary constituency/ })).not.toBeInTheDocument();
  });

  it("matched coverage is refused when a zone round is selected with an AC round", async () => {
    stubApi();
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole("checkbox", { name: R1 }));
    await chooseLevel(user, /^Zone/);
    await user.click(await screen.findByRole("checkbox", { name: "2027 VS CAPI ST R1" }));
    await user.click(screen.getByText("Seat coverage"));
    expect(screen.getByRole("radio", { name: /Matched seats only/ })).toBeDisabled();
    expect(screen.getByText(/Matched seats need AC or PC rounds; 2027 VS CAPI ST R1 is not/)).toBeInTheDocument();
  });

  it("compare cannot be the anchor", async () => {
    stubApi();
    const user = userEvent.setup();
    renderBar(URL_CTX);
    await user.click(await screen.findByRole("button", { name: "Edit context" }));
    expect(await screen.findByRole("checkbox", { name: R2 })).toHaveAccessibleDescription(/403 seats · Extrapolated Current round/);
    await user.click(await screen.findByRole("textbox", { name: "Compare with" }));
    // Anchor defaults to the last selected round (R2), so only R1 is offered.
    expect(await screen.findByRole("option", { name: R1 })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: R2 })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "No comparison" })).toBeInTheDocument();
  });

  it("mixed series is labelled", async () => {
    const first = surveys.levels.ac![0];
    const other = {
      ...first, series: "CATI", group: "2027 VS · CATI",
      rounds: first.rounds.map((r) => ({ ...r, base_name: r.base_name.replace("CAPI", "CATI") })),
    };
    stubApi({ surveys: { ...surveys, levels: { ...surveys.levels, ac: [first, other] } } });
    const user = userEvent.setup();
    renderStep();
    const boxes = await screen.findAllByRole("checkbox", { name: /^2027 VS (CAPI|CATI) R1$/ });
    expect(screen.queryByText(/^Different survey series\./)).not.toBeInTheDocument();
    await user.click(boxes[0]);
    await user.click(boxes[1]);
    expect(await screen.findByText(/^Different survey series\./)).toBeInTheDocument();
  });

  it("apply writes the URL", async () => {
    stubApi();
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole("checkbox", { name: R1 }));
    await user.click(screen.getByRole("checkbox", { name: R2 }));
    expect(screen.getByTestId("search").textContent).toBe("");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      const ctx = parseContext(new URLSearchParams(screen.getByTestId("search").textContent ?? ""));
      expect(ctx).toEqual({
        state: "Uttar Pradesh", rounds: [R1, R2], compare_round: null,
        anchor_round: null, version_mode: "extrapolated", geo_scope: "state",
      });
    });
    expect(await screen.findByTestId("context-pill")).toHaveTextContent(/Uttar Pradesh · AC level · .* R1–R2 · No Δ · Extrapolated · Geo: whole state/);
  });

  it("shows the lead card plan error verbatim", async () => {
    stubApi({ planResponse: json({ errors: ["compare round is not selected"] }, 422) });
    const user = userEvent.setup();
    renderBar(URL_CTX);
    await user.click(await screen.findByRole("button", { name: "Edit context" }));
    expect(await screen.findByText("compare round is not selected")).toBeInTheDocument();
  });

  it("changing state clears the chosen rounds", async () => {
    stubApi({ states: ["Uttar Pradesh", "Bihar"] });
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole("textbox", { name: "State" }));
    await user.click(await screen.findByRole("option", { name: "Uttar Pradesh" }));
    await user.click(await screen.findByRole("checkbox", { name: R1 }));
    expect(screen.getByRole("checkbox", { name: R1 })).toBeChecked();
    await user.click(screen.getByRole("textbox", { name: "State" }));
    await user.click(await screen.findByRole("option", { name: "Bihar" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: R1 })).not.toBeChecked());
  });

  it("omits seats when a version has none", async () => {
    const first = surveys.levels.ac![0];
    const rounds = first.rounds.map((r) => ({
      ...r,
      versions: Object.fromEntries(Object.entries(r.versions).map(([k, v]) => [k, { ...v, seats: undefined }])),
    }));
    stubApi({ surveys: { ...surveys, levels: { ac: [{ ...first, rounds }] } } as unknown as SurveysResponse });
    renderStep();
    expect(await screen.findByRole("checkbox", { name: R1 })).toBeInTheDocument();
    expect(screen.queryByText(/\b(?:undefined|\d+) seats\b/)).not.toBeInTheDocument();
  });

  it.each(["Cancel", "Escape"])("%s discards the draft and reopens with the applied comparison", async (dismiss) => {
    stubApi();
    const user = userEvent.setup();
    renderBar(URL_CTX);
    const edit = await screen.findByRole("button", { name: "Edit context" });
    await user.click(edit);
    expect(await screen.findByText("2027 VS CAPI R2 − 2027 VS CAPI R1")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: R1 }));
    expect(screen.queryByText("2027 VS CAPI R2 − 2027 VS CAPI R1")).not.toBeInTheDocument();
    if (dismiss === "Escape") await user.keyboard("{Escape}");
    else await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("search")).toHaveTextContent(/compare=2027%20VS%20CAPI%20R1/);
    await user.click(edit);
    expect(await screen.findByRole("checkbox", { name: R1 })).toBeChecked();
    expect(screen.getByText("2027 VS CAPI R2 − 2027 VS CAPI R1")).toBeInTheDocument();
  });

  it("explains why matched coverage is unavailable for a selected round without a Normal version", async () => {
    const group = surveys.levels.ac![0];
    const rounds = group.rounds.map((round) => round.base_name === R2
      ? { ...round, versions: { extrapolated: round.versions.extrapolated } }
      : round);
    stubApi({ surveys: { ...surveys, levels: { ac: [{ ...group, rounds }] } } });
    const user = userEvent.setup();
    renderBar(URL_CTX);
    await user.click(await screen.findByRole("button", { name: "Edit context" }));
    await user.click(await screen.findByText("Seat coverage", { exact: true }));
    expect(screen.getByRole("radio", { name: "Matched seats only" })).toBeDisabled();
    expect(screen.getByText("2027 VS CAPI R2 has no Normal dataset.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply selection" })).toBeEnabled();
  });
  it.each([
    ["compare", `&compare=${encodeURIComponent(R1)}`, "compare_round"],
    ["anchor", `&anchor=${encodeURIComponent(R1)}`, "anchor_round"],
  ] as const)("deselecting the %s round leaves no dangling value", async (_n, extra, key) => {
    stubApi();
    const user = userEvent.setup();
    renderBar(`/?state=Uttar+Pradesh&level=ac&rounds=${encodeURIComponent(R1)}&rounds=${encodeURIComponent(R2)}${extra}`);
    await user.click(await screen.findByRole("button", { name: "Edit context" }));
    await user.click(await screen.findByRole("checkbox", { name: R1 }));
    await user.click(screen.getByRole("button", { name: "Apply selection" }));
    await waitFor(() => {
      const ctx = parseContext(new URLSearchParams(screen.getByTestId("search").textContent ?? ""));
      expect(ctx?.rounds).toEqual([R2]);
      expect(ctx?.[key]).toBeNull();
    });
  });
});

describe("the session cohort", () => {
  it("shows its label and seat count in the bar and Clear removes it", async () => {
    const { setCohort, getCohort, clearCohort } = await import("../cohorts/cohortStore");
    stubApi();
    setCohort("Uttar Pradesh", { seat_level: "ac", seat_ids: [3, 12], label: "Top 2 AC", created_at: "2026-11-18T00:00:00Z" });
    try {
      renderBar(URL_CTX);
      const pill = await screen.findByTestId("cohort-pill");
      expect(pill).toHaveTextContent("Top 2 AC");
      expect(pill).toHaveTextContent("2 AC seats");
      await userEvent.click(screen.getByRole("button", { name: "Clear cohort" }));
      expect(getCohort("Uttar Pradesh")).toBeNull();
      await waitFor(() => expect(screen.queryByTestId("cohort-pill")).not.toBeInTheDocument());
    } finally {
      clearCohort("Uttar Pradesh");
    }
  });
});
