import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import planJson from "../test/fixtures/plan_scoreboard.json";
import doneJson from "../test/fixtures/run_scoreboard_done.json";
import statesJson from "../test/fixtures/states.json";
import surveysJson from "../test/fixtures/surveys.json";
import templatesJson from "../test/fixtures/templates_pulse.json";
import { renderWithProviders } from "../test/render";

const CONTEXT = "?state=Uttar+Pradesh&level=ac&rounds=2027+VS+CAPI+R1&version=extrapolated";

function stubApi(templates: unknown = templatesJson) {
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api/, "");
    const method = init?.method ?? "GET";
    let json: unknown = { detail: "not found" };
    if (path === "/catalogue/states") json = statesJson;
    else if (path.endsWith("/surveys")) json = surveysJson;
    else if (path.startsWith("/templates")) json = templates;
    else if (method === "POST" && path === "/cards/plan") json = planJson;
    else if (method === "POST" && path === "/cards/run") json = { run_id: "r1" };
    else if (path.startsWith("/runs/")) json = doneJson;
    return new Response(JSON.stringify(json));
  });
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("State Pulse", () => {
  it("pulse renders four cards in template order", async () => {
    stubApi();
    renderWithProviders(<AppRoutes />, { route: `/pulse${CONTEXT}` });
    const titles = ["Party scoreboard", "Leader satisfaction", "Appetite for change", "Support by zone"];
    await screen.findByText(titles[3] ?? "");
    const found = screen.getAllByRole("heading", { level: 4 });
    expect(found.map((h) => h.textContent)).toEqual(titles);
  });

  it("nav keeps context in links", async () => {
    stubApi();
    renderWithProviders(<AppRoutes />, { route: `/pulse${CONTEXT}` });
    const link = await screen.findByRole("link", { name: "Vote Movement" });
    expect(link).toHaveAttribute("href", `/movement${CONTEXT}`);
  });

  it("other sections say when they arrive", async () => {
    stubApi();
    renderWithProviders(<AppRoutes />, { route: `/coalitions${CONTEXT}` });
    expect(await screen.findByText("Voter Coalitions arrives in phase 2")).toBeInTheDocument();
  });

  it("my cards says phase 3", async () => {
    stubApi();
    renderWithProviders(<AppRoutes />, { route: "/my-cards" });
    expect(await screen.findByText("My cards arrives in phase 3")).toBeInTheDocument();
  });

  it("root redirects to pulse keeping the search", async () => {
    stubApi();
    renderWithProviders(<AppRoutes />, { route: `/${CONTEXT}` });
    expect(await screen.findByText("Party scoreboard")).toBeInTheDocument();
  });

  it("no context shows prompt and no runs", async () => {
    const f = stubApi();
    renderWithProviders(<AppRoutes />, { route: "/pulse" });
    expect(await screen.findByText("Choose a state, survey level and rounds to begin.")).toBeInTheDocument();
    expect(screen.queryByText("Party scoreboard")).not.toBeInTheDocument();
    const cardCalls = f.mock.calls.filter(([u]) => String(u).startsWith("/api/cards/"));
    expect(cardCalls).toHaveLength(0);
  });

  it("unknown paths go to pulse keeping the search", async () => {
    stubApi();
    renderWithProviders(<AppRoutes />, { route: `/foo${CONTEXT}` });
    expect(await screen.findByText("Party scoreboard")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vote Movement" })).toHaveAttribute("href", `/movement${CONTEXT}`);
  });

  it("shows loading while templates load", async () => {
    stubApi();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderWithProviders(<AppRoutes />, { route: `/pulse${CONTEXT}` });
    expect(await screen.findByLabelText("Loading cards…")).toBeInTheDocument();
  });

  it("says so when there are no cards", async () => {
    stubApi([]);
    renderWithProviders(<AppRoutes />, { route: `/pulse${CONTEXT}` });
    expect(await screen.findByText("No cards are available for this section.")).toBeInTheDocument();
  });
});
