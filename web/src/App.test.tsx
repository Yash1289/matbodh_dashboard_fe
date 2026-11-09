import { render, screen } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { App } from "./App";

afterEach(() => vi.unstubAllGlobals());

// App owns its providers (including BrowserRouter), so it is rendered bare.
test("renders the product name", () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ states: [] }))));
  render(<App />);
  expect(screen.getByText("MatBodh Dashboard")).toBeInTheDocument();
});
