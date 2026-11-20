import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TableFrame } from "./TableFrame";

const table = (
  <table aria-label="t"><tbody><tr><th scope="row">A</th><td>1</td></tr></tbody></table>
);

describe("TableFrame", () => {
  it("marks itself scrolled once content has moved under the pinned column", () => {
    render(<TableFrame>{table}</TableFrame>);
    const frame = screen.getByTestId("table-frame");
    expect(frame).toHaveAttribute("data-scrolled", "false");
    frame.scrollLeft = 5;
    fireEvent.scroll(frame);
    expect(frame).toHaveAttribute("data-scrolled", "true");
    frame.scrollLeft = 0;
    fireEvent.scroll(frame);
    expect(frame).toHaveAttribute("data-scrolled", "false");
  });

  it("passes the table's minimum width in em through a custom property", () => {
    render(<TableFrame minWidthEm={38}>{table}</TableFrame>);
    expect(screen.getByTestId("table-frame").style.getPropertyValue("--table-min")).toBe("38em");
  });

  it("leaves the minimum width unset by default so the table fills the card", () => {
    render(<TableFrame>{table}</TableFrame>);
    expect(screen.getByTestId("table-frame").style.getPropertyValue("--table-min")).toBe("");
  });

  it("limits its height when asked, so the header can stay in view", () => {
    render(<TableFrame maxHeight="70vh">{table}</TableFrame>);
    expect(screen.getByTestId("table-frame").style.maxHeight).toBe("70vh");
  });
});
