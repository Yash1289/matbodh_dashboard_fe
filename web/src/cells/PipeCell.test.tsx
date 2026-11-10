import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PipeCell } from "./PipeCell";

describe("PipeCell", () => {
  it("renders one segment per round with separators between them", () => {
    const { container } = render(
      <PipeCell values={[41, 43, 44, 45]} unit="pct" labels={["R1", "R2", "R3", "R4"]} flags={[[], [], [], []]} />,
    );
    expect(container.querySelectorAll("[data-segment]")).toHaveLength(4);
    expect(container.querySelectorAll("[data-separator]")).toHaveLength(3);
    expect(container.textContent).toBe("41%43%44%45%");
  });

  it("labels each segment with its full round label for assistive technology", () => {
    render(<PipeCell values={[41, 43]} unit="pct" labels={["R1", "R2"]} flags={[[], []]} />);
    expect(screen.getByLabelText("R1: 41%")).toBeInTheDocument();
    expect(screen.getByLabelText("R2: 43%")).toBeInTheDocument();
  });

  it("shows an em dash with the reason for a null segment, never a zero", () => {
    const { container } = render(
      <PipeCell values={[null, 44]} unit="pct" labels={["R1", "R2"]} flags={[["not_asked"], []]} />,
    );
    expect(screen.getByTitle("Not asked in this round")).toHaveTextContent("—");
    expect(container.textContent).toBe("—44%");
    expect(container.textContent).not.toMatch(/(^|[^\d])0%/);
  });

  it("formats percentage-point values with their sign", () => {
    const { container } = render(<PipeCell values={[3, -4]} unit="pp" labels={["R1", "R2"]} flags={[[], []]} />);
    expect(container.textContent).toBe("+3%−4%");
  });
});
