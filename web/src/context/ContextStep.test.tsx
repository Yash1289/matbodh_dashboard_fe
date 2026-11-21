import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import plan from "../test/fixtures/plan_scoreboard.json";
import states from "../test/fixtures/states.json";
import surveys from "../test/fixtures/surveys.json";
import { renderWithProviders } from "../test/render";
import { ContextStep } from "./ContextStep";
import { saveLastContext } from "./lastContext";
import { parseContext } from "./urlContext";
import { useLocation } from "react-router-dom";

const R1 = "2027 VS CAPI R1";
const R2 = "2027 VS CAPI R2";
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

function stubApi() {
  const fetchMock = vi.fn((url: string) => {
    if (url.endsWith("/catalogue/states")) return Promise.resolve(json(states));
    if (url.endsWith("/surveys")) return Promise.resolve(json(surveys));
    if (url.endsWith("/cards/plan")) return Promise.resolve(json(plan));
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const Probe = () => <div data-testid="search">{useLocation().search}</div>;
const renderStep = () => renderWithProviders(<><ContextStep /><Probe /></>, { route: "/" });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

async function chooseLevel(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await screen.findByRole("textbox", { name: "Survey level" }));
  await user.click(await screen.findByRole("option", { name }));
}

describe("ContextStep", () => {
  it("is a page of its own, not a dialog, and runs nothing", async () => {
    const fetchMock = stubApi();
    renderStep();
    expect(screen.getByRole("heading", { level: 1, name: "Survey context" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await screen.findByRole("checkbox", { name: R1 });
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/cards/run"))).toBe(false);
  });

  it("offers Continue, not Apply or Cancel, and Continue waits for a round", async () => {
    stubApi();
    renderStep();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Apply selection" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Choose at least one round to continue/);
  });

  it("Continue writes the chosen context to the URL", async () => {
    stubApi();
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole("checkbox", { name: R1 }));
    await user.click(screen.getByRole("checkbox", { name: R2 }));
    expect(screen.getByTestId("search").textContent).toBe("");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      const ctx = parseContext(new URLSearchParams(screen.getByTestId("search").textContent ?? ""));
      expect(ctx).toMatchObject({ state: "Uttar Pradesh", rounds: [R1, R2] });
    });
  });

  const LAST = {
    state: "Uttar Pradesh", rounds: [R1, R2], compare_round: null, anchor_round: null,
    version_mode: "extrapolated" as const, geo_scope: "state" as const,
  };

  it("offers to continue with the last context, focused so Enter takes it, and checks it still exists", async () => {
    stubApi();
    saveLastContext(LAST);
    const user = userEvent.setup();
    renderStep();
    const button = await screen.findByRole("button", { name: /^Continue with Uttar Pradesh/ });
    await waitFor(() => expect(button).toHaveFocus());
    await user.click(button);
    await waitFor(() => {
      expect(parseContext(new URLSearchParams(screen.getByTestId("search").textContent ?? ""))).toMatchObject({ state: "Uttar Pradesh", rounds: [R1, R2] });
    });
  });

  it("does not offer a remembered context whose rounds are no longer in the catalogue", async () => {
    stubApi();
    saveLastContext({ ...LAST, rounds: ["2027 VS CAPI R9"] });
    renderStep();
    await screen.findByRole("checkbox", { name: R1 });
    expect(screen.queryByRole("button", { name: /^Continue with/ })).not.toBeInTheDocument();
  });

  it("offers nothing to continue on a first visit", async () => {
    stubApi();
    renderStep();
    await screen.findByRole("checkbox", { name: R1 });
    expect(screen.queryByRole("button", { name: /^Continue with/ })).not.toBeInTheDocument();
  });

  it("section headings are h2 under the page's h1", async () => {
    stubApi();
    renderStep();
    expect(screen.getByRole("heading", { level: 2, name: "Survey rounds" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("the level only filters the list: a round chosen at one level stays chosen at another", async () => {
    stubApi();
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole("checkbox", { name: R1 }));
    expect(screen.queryByRole("checkbox", { name: "2027 VS CAPI ST R1" })).not.toBeInTheDocument();
    await chooseLevel(user, /^Zone/);
    expect(screen.queryByRole("checkbox", { name: R1 })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("checkbox", { name: "2027 VS CAPI ST R1" }));
    await chooseLevel(user, /^Assembly constituency/);
    expect(await screen.findByRole("checkbox", { name: R1 })).toBeChecked();
    const chips = within(screen.getByRole("list", { name: "Selected rounds" }));
    expect(chips.getByRole("button", { name: `Remove ${R1}` })).toBeInTheDocument();
    expect(chips.getByRole("button", { name: "Remove 2027 VS CAPI ST R1" })).toBeInTheDocument();
  });

  it("Continue with rounds of two levels sends both and an explicit anchor, and no level", async () => {
    stubApi();
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole("checkbox", { name: R2 }));
    await chooseLevel(user, /^Zone/);
    await user.click(await screen.findByRole("checkbox", { name: "2027 VS CAPI ST R1" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      const params = new URLSearchParams(screen.getByTestId("search").textContent ?? "");
      expect(params.getAll("rounds")).toEqual([R2, "2027 VS CAPI ST R1"]);
      expect(params.get("anchor")).not.toBeNull();
      expect(params.has("level")).toBe(false);
    });
  });

  it("Comparison appears once a round is chosen, not before", async () => {
    stubApi();
    const user = userEvent.setup();
    renderStep();
    expect(screen.queryByRole("heading", { name: "Comparison" })).toBeNull();
    await user.click(await screen.findByRole("checkbox", { name: R1 }));
    expect(await screen.findByRole("heading", { name: "Comparison" })).toBeInTheDocument();
  });

  it("a progress list marks where, rounds and ready as they are done", async () => {
    stubApi();
    const user = userEvent.setup();
    renderStep();
    const list = screen.getByRole("list", { name: "Progress" });
    expect(list.querySelectorAll("[data-done='true']")).toHaveLength(0);
    await waitFor(() => expect(list.querySelectorAll("[data-done='true']")).toHaveLength(1));
    await user.click(await screen.findByRole("checkbox", { name: R1 }));
    await waitFor(() => expect(list.querySelectorAll("[data-done='true']")).toHaveLength(3));
  });

  it("with reduced motion, Continue applies at once, with no leaving animation to wait for", async () => {
    stubApi();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: /prefers-reduced-motion/.test(query), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }));
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole("checkbox", { name: R1 }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByTestId("search").textContent).toContain("state=Uttar+Pradesh");
  });
});
