import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import planJson from "../test/fixtures/plan_scoreboard.json";
import doneJson from "../test/fixtures/run_scoreboard_done.json";
import statesJson from "../test/fixtures/states.json";
import surveysJson from "../test/fixtures/surveys.json";
import templatesJson from "../test/fixtures/templates_pulse.json";
import { renderWithProviders } from "../test/render";

const CONTEXT = "?state=Uttar+Pradesh&level=ac&rounds=2027+VS+CAPI+R1&version=extrapolated";

function stubApi() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api/, "");
    let json: unknown = { detail: "not found" };
    if (path === "/catalogue/states") json = statesJson;
    else if (path.endsWith("/surveys")) json = surveysJson;
    else if (path.startsWith("/templates")) json = templatesJson;
    else if (init?.method === "POST" && path === "/cards/plan") json = planJson;
    else if (init?.method === "POST" && path === "/cards/run") json = { run_id: "r1" };
    else if (path.startsWith("/runs/")) json = doneJson;
    return new Response(JSON.stringify(json));
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("shell", () => {
  it("top bar shows brand, context pill and Edit context", async () => {
    stubApi();
    renderWithProviders(<AppRoutes />, { route: `/pulse${CONTEXT}` });
    expect(screen.getByText("MatBodh")).toBeInTheDocument();
    const pill = await screen.findByTestId("context-pill");
    await waitFor(() => expect(pill).toHaveTextContent(/^Uttar Pradesh · AC level · .* · Geo: whole state$/));
    expect(screen.getByRole("button", { name: "Edit context" })).toBeInTheDocument();
    expect(screen.queryByText("+ Add state")).not.toBeInTheDocument();
    await screen.findByText("Party scoreboard");
  });

  it("nav labels and active style", async () => {
    stubApi();
    renderWithProviders(<AppRoutes />, { route: `/pulse${CONTEXT}` });
    const nav = screen.getByRole("navigation", { name: "Sections" });
    for (const label of ["State Pulse", "Seat Battleground", "Voter Coalitions", "Leadership", "Vote Movement", "My cards", "+ Add a cut"]) {
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", expect.stringContaining(CONTEXT));
    }
    expect(within(nav).getByText("SECTIONS")).toBeInTheDocument();
    expect(within(nav).getByText("MINE")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "State Pulse" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Vote Movement" })).not.toHaveAttribute("aria-current");
    await screen.findByText("Party scoreboard");
  });

  it("placeholder pages keep the full section name", async () => {
    stubApi();
    renderWithProviders(<AppRoutes />, { route: `/leadership${CONTEXT}` });
    expect(await screen.findByText("Leadership & Anti-incumbency arrives in phase 2")).toBeInTheDocument();
    await screen.findByTestId("context-pill");
    await waitFor(() => expect(screen.getByTestId("context-pill")).toHaveTextContent("Geo: whole state"));
  });
});
