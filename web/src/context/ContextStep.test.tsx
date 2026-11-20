import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import plan from "../test/fixtures/plan_scoreboard.json";
import states from "../test/fixtures/states.json";
import surveys from "../test/fixtures/surveys.json";
import { renderWithProviders } from "../test/render";
import { ContextStep } from "./ContextStep";
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
afterEach(() => vi.unstubAllGlobals());

describe("ContextStep", () => {
  it("is a page of its own, not a dialog, and runs nothing", async () => {
    const fetchMock = stubApi();
    renderStep();
    expect(screen.getByRole("heading", { level: 1, name: "Survey context" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Survey level" })).toBeEnabled());
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/cards/run"))).toBe(false);
  });

  it("offers Continue, not Apply or Cancel, and Continue waits for a level and a round", async () => {
    stubApi();
    renderStep();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Apply selection" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Choose a survey level and at least one round/);
  });

  it("Continue writes the chosen context to the URL", async () => {
    stubApi();
    const user = userEvent.setup();
    renderStep();
    await user.click(await screen.findByRole("textbox", { name: "Survey level" }));
    await user.click(await screen.findByRole("option", { name: "Assembly constituency (AC)" }));
    await user.click(await screen.findByRole("checkbox", { name: R1 }));
    await user.click(screen.getByRole("checkbox", { name: R2 }));
    expect(screen.getByTestId("search").textContent).toBe("");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      const ctx = parseContext(new URLSearchParams(screen.getByTestId("search").textContent ?? ""));
      expect(ctx).toMatchObject({ state: "Uttar Pradesh", level: "ac", rounds: [R1, R2] });
    });
  });
});
