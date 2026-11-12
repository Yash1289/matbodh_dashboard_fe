import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatValue } from "../../cells/format";
import { RELATIONSHIP } from "../../test/cardApi";
import { renderWithProviders } from "../../test/render";
import { initialRelationshipView, type RelationshipView } from "./relationshipRows";
import { RelationshipMatrixTable } from "./RelationshipMatrix";
import { RelationshipSummaryTable } from "./RelationshipSummary";

const headers = () => screen.getAllByRole("columnheader").map((h) => h.textContent);
const matrixView = (over: Partial<RelationshipView> = {}): RelationshipView => {
  const p = RELATIONSHIP.transition();
  return { ...initialRelationshipView(p), table: "matrix", round: "R2", values: { gender: "Male" }, ...over };
};

describe("RelationshipSummaryTable", () => {
  it("shows exactly the five focal columns, round values as pipes in round order", () => {
    const p = RELATIONSHIP.transition();
    renderWithProviders(<RelationshipSummaryTable payload={p} view={initialRelationshipView(p)} />);
    expect(headers()).toEqual(["Group", "Net flow (pp)", "Retention share", "Gained population share",
      "Lost population share", "Acquisition share"]);
    const row = screen.getByRole("rowheader", { name: "Male" }).closest("tr")!;
    const r1 = p.summaries.find((s) => s.round === "R1" && s.group.dimensions.gender === "Male")!;
    const r2 = p.summaries.find((s) => s.round === "R2" && s.group.dimensions.gender === "Male")!;
    const retention = within(row).getAllByRole("cell")[1]; // net flow is the first value column, retention the second
    const segments = within(retention).getAllByLabelText(/^R[12]:/);
    expect(segments.map((s) => s.textContent)).toEqual([
      formatValue(r1.retention_share, "pct"), formatValue(r2.retention_share, "pct")]);
    const netFlow = within(within(row).getAllByRole("cell")[0]).getAllByLabelText(/^R[12]:/);
    expect(netFlow.map((s) => s.textContent)).toEqual([formatValue(r1.net_flow_pp, "pp"), formatValue(r2.net_flow_pp, "pp")]);
  });

  it("names each column's base in its header tooltip", () => {
    const p = RELATIONSHIP.transition();
    renderWithProviders(<RelationshipSummaryTable payload={p} view={initialRelationshipView(p)} />);
    const retention = screen.getByRole("columnheader", { name: "Retention share" });
    expect(retention).toHaveAttribute("title", expect.stringContaining(p.focal_party!));
  });

  it("adds the Details columns on request", () => {
    const p = RELATIONSHIP.transition();
    renderWithProviders(<RelationshipSummaryTable payload={p} view={{ ...initialRelationshipView(p), showDetails: true }} />);
    expect(headers()).toEqual(expect.arrayContaining(["Agreement share", "Loss share", "Conversion share",
      "Neither population share", "Composition share", "Focal origin base", "Focal destination base",
      "Paired base", "Respondents"]));
  });

  it("shows Agreement share alone without a focal party", () => {
    const p = RELATIONSHIP.transition();
    p.focal_party = null;
    renderWithProviders(<RelationshipSummaryTable payload={p} view={initialRelationshipView(p)} />);
    expect(headers()).toEqual(["Group", "Agreement share"]);
  });

  it("says so when the engine returned no groups, and when a search matches nothing", () => {
    const p = RELATIONSHIP.transition();
    const empty = { ...p, groups: [], summaries: [], cells: [] };
    const { unmount } = renderWithProviders(<RelationshipSummaryTable payload={empty} view={initialRelationshipView(empty)} />);
    expect(screen.getByText("The engine returned no relationship rows.")).toBeInTheDocument();
    unmount();
    renderWithProviders(<RelationshipSummaryTable payload={p} view={{ ...initialRelationshipView(p), search: "zzzz" }} />);
    expect(screen.getByText(/No groups match/)).toBeInTheDocument();
  });
});

describe("RelationshipMatrixTable", () => {
  it("shows exactly the four measure columns and nine pair rows with the diagonal marked", () => {
    const p = RELATIONSHIP.transition();
    renderWithProviders(<RelationshipMatrixTable payload={p} view={matrixView()} />);
    expect(headers()).toEqual(["Origin → destination", "Origin share", "Destination share", "Joint share", "Size of impact (pp)"]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(9);
    expect(screen.getAllByText("stayed")).toHaveLength(3);
    expect(rows.filter((r) => r.hasAttribute("data-focal"))).toHaveLength(5);
  });

  it("copies the engine's numbers into the cells", () => {
    const p = RELATIONSHIP.transition();
    renderWithProviders(<RelationshipMatrixTable payload={p} view={matrixView()} />);
    const cell = p.cells.find((c) => c.round === "R2" && c.group.dimensions.gender === "Male" && c.origin === "BJP+" && c.destination === "SP+")!;
    const row = screen.getByRole("rowheader", { name: /BJP\+ → SP\+/ }).closest("tr")!;
    const values = within(row).getAllByRole("cell").map((c) => c.textContent);
    expect(values).toEqual([formatValue(cell.origin_share, "pct"), formatValue(cell.destination_share, "pct"),
      formatValue(cell.joint_share, "pct"), formatValue(cell.size_of_impact_pp, "pp")]);
  });

  it("shows a dash with the reason for an absent cell and no number (every cell of an all-absent group)", () => {
    const p = RELATIONSHIP.transition();
    p.cells = p.cells.map((c) => c.round === "R2" && c.group.dimensions.gender === "Male"
      ? { ...c, absent: "no_respondents", origin_share: null, destination_share: null, joint_share: null, size_of_impact_pp: null }
      : c);
    renderWithProviders(<RelationshipMatrixTable payload={p} view={matrixView()} />);
    const rows = screen.getAllByRole("row").slice(1);
    for (const row of rows) {
      const reason = within(row).getByRole("rowheader").textContent?.includes("stayed") ? "no respondents stayed" : "no respondents moved";
      for (const cell of within(row).getAllByRole("cell")) {
        expect(cell).toHaveTextContent("—");
        expect(cell.textContent).not.toMatch(/\d/);
        expect(within(cell).getByTitle(reason)).toHaveAttribute("aria-label", reason); // reachable without hover
      }
    }
    expect(screen.getByText(/means no respondents moved/)).toBeInTheDocument(); // a visible line, not only a tooltip
  });

  it("shows no absent-cell footnote when every cell has numbers", () => {
    const p = RELATIONSHIP.transition();
    renderWithProviders(<RelationshipMatrixTable payload={p} view={matrixView()} />);
    expect(screen.queryByText(/means no respondents moved/)).toBeNull();
  });

  it("adds counts and bases under Details", () => {
    const p = RELATIONSHIP.transition();
    renderWithProviders(<RelationshipMatrixTable payload={p} view={matrixView({ showDetails: true })} />);
    expect(headers()).toEqual(expect.arrayContaining(["Respondents", "Origin base", "Destination base", "Paired base", "Paired respondents"]));
  });

  it("says so when the chosen group does not exist in the round", () => {
    const p = RELATIONSHIP.transition();
    renderWithProviders(<RelationshipMatrixTable payload={p} view={matrixView({ values: { gender: "Other" } })} />);
    expect(screen.getByText("No such group in this round")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
