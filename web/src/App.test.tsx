import { render, screen } from "@testing-library/react";
import { App } from "./App";

// App owns its providers (including BrowserRouter), so it is rendered bare.
test("renders the product name", () => {
  render(<App />);
  expect(screen.getByText("MatBodh Dashboard")).toBeInTheDocument();
});
