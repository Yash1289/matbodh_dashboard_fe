import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import type { CellGrid } from "../../table/grid";
import type { RankedListResult, TransitionMatrixResult, BattlegroundResult, RoundsBlock } from "../../api/types";
import {
  CompositeGridBody,
  RankedListBody,
  TransitionMatrixBody,
  BattlegroundSummaryBody,
} from "./index";

describe("Specialized Body Adapters", () => {
  describe("RankedListBody", () => {
    it("renders ranked list with competition tie badges, partition tabs, and secondary stats", async () => {
      const data: RankedListResult = {
        measure: "net_score",
        polarity: "highest_first",
        total_ranked: 3,
        partitions: [
          {
            partition_key: "state",
            partition_label: "Statewide",
            items: [
              {
                rank: 1,
                label: "Varanasi Cantt",
                value: 45.0,
                delta: 3.2,
                measure: "net_score",
                secondary: "62% sat · 17% dis",
                tags: ["Eastern"],
                colour: "#ff9933",
              },
              {
                rank: 1,
                label: "Gorakhpur Urban",
                value: 45.0,
                delta: 1.4,
                measure: "net_score",
                secondary: "60% sat · 15% dis",
                tags: ["Eastern"],
              },
            ],
          },
          {
            partition_key: "west",
            partition_label: "Western",
            items: [
              {
                rank: 1,
                label: "Noida",
                value: 52.0,
                delta: null,
                measure: "net_score",
                secondary: "70% sat · 18% dis",
              },
            ],
          },
        ],
      };

      const onInvestigate = vi.fn();
      render(
        <MantineProvider>
          <RankedListBody data={data} onInvestigate={onInvestigate} />
        </MantineProvider>
      );

      // Both tied items in Statewide have #1
      expect(screen.getAllByText("#1")).toHaveLength(2);
      expect(screen.getByText("Varanasi Cantt")).toBeInTheDocument();
      expect(screen.getByText("Gorakhpur Urban")).toBeInTheDocument();
      expect(screen.getByText("62% sat · 17% dis")).toBeInTheDocument();

      // Delta is rendered for both (|v| >= 2.0 -> 3%, |v| < 2.0 -> 1.40%)
      expect(screen.getByText(/▲3%/)).toBeInTheDocument();
      expect(screen.getByText(/▲1.40%/)).toBeInTheDocument();

      // Clicking row triggers onInvestigate
      await userEvent.click(screen.getByText("Varanasi Cantt"));
      expect(onInvestigate).toHaveBeenCalledWith(
        expect.objectContaining({ label: "Varanasi Cantt", rank: 1 })
      );

      // Tabs exist for multiple partitions
      const westernTab = screen.getByRole("tab", { name: "Western" });
      expect(westernTab).toBeInTheDocument();
      await userEvent.click(westernTab);

      // Now Noida is visible and Varanasi Cantt is not in Western tab
      expect(screen.getByText("Noida")).toBeInTheDocument();
    });

    it("renders competition ties sequence 1, 2, 2, 4 properly", () => {
      const data: RankedListResult = {
        measure: "support_share",
        polarity: "highest_first",
        total_ranked: 4,
        partitions: [
          {
            partition_key: "state",
            partition_label: "Statewide",
            items: [
              { rank: 1, label: "Seat A", value: 50.0, delta: null, measure: "support_share" },
              { rank: 2, label: "Seat B", value: 45.0, delta: null, measure: "support_share" },
              { rank: 2, label: "Seat C", value: 45.0, delta: null, measure: "support_share" },
              { rank: 4, label: "Seat D", value: 40.0, delta: null, measure: "support_share" },
            ],
          },
        ],
      };

      render(
        <MantineProvider>
          <RankedListBody data={data} />
        </MantineProvider>
      );

      expect(screen.getByText("#1")).toBeInTheDocument();
      expect(screen.getAllByText("#2")).toHaveLength(2);
      expect(screen.getByText("#4")).toBeInTheDocument();
    });

    it("renders null metric values as em-dash —", () => {
      const data: RankedListResult = {
        measure: "support_share",
        polarity: "highest_first",
        total_ranked: 1,
        partitions: [
          {
            partition_key: "state",
            partition_label: "Statewide",
            items: [
              {
                rank: 1,
                label: "Unpolled Seat",
                value: null,
                delta: null,
                measure: "support_share",
              },
            ],
          },
        ],
      };

      render(
        <MantineProvider>
          <RankedListBody data={data} />
        </MantineProvider>
      );

      expect(screen.getByText("Unpolled Seat")).toBeInTheDocument();
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("renders empty text when no partitions are present", () => {
      const data: RankedListResult = {
        measure: "support_share",
        polarity: "highest_first",
        total_ranked: 0,
        partitions: [],
      };

      render(
        <MantineProvider>
          <RankedListBody data={data} />
        </MantineProvider>
      );

      expect(screen.getByText("No ranked items")).toBeInTheDocument();
    });
  });

  describe("BattlegroundSummaryBody", () => {
    it("renders battleground flip tiles and triggers onInvestigate on click", async () => {
      const onInvestigate = vi.fn();
      const data: BattlegroundResult = {
        flips: { winning_both: 142, gain: 18, loss: 12, losing_both: 231 },
        margin_buckets: [
          { bucket: "0-5% Win", count: 8, seat_ids: ["AC01", "AC02"] },
          { bucket: "5-10% Win", count: 10, seat_ids: ["AC03"] },
          { bucket: "0-5% Loss", count: 6, seat_ids: ["AC04"] },
        ],
        seats: [
          { seat_id: "AC01", winner: "NDA", margin_pp: 2.4, flip: "gain" },
          { seat_id: "AC02", winner: "NDA", margin_pp: 4.1, flip: "gain" },
        ],
      };

      render(
        <MantineProvider>
          <BattlegroundSummaryBody data={data} onInvestigate={onInvestigate} />
        </MantineProvider>
      );

      // KPI Flip tiles
      expect(screen.getByText(/Gain \(\+18\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Held \(142\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Lost \(-12\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Opp Held \(231\)/i)).toBeInTheDocument();

      // Margin buckets
      expect(screen.getByText("0-5% Win")).toBeInTheDocument();
      expect(screen.getByText("8 seats")).toBeInTheDocument();
      expect(screen.getByText("5-10% Win")).toBeInTheDocument();
      expect(screen.getByText("10 seats")).toBeInTheDocument();

      // CTA button
      const btn = screen.getByText(/Investigate gained seats/i);
      await userEvent.click(btn);

      expect(onInvestigate).toHaveBeenCalledWith(
        expect.objectContaining({
          flip: "gain",
          count: 18,
          seat_ids: ["AC01", "AC02"],
        })
      );
    });
  });

  describe("TransitionMatrixBody", () => {
    const data: TransitionMatrixResult = {
      origins: ["NDA (2022)", "SP+ (2022)", "Did Not Vote"],
      destinations: ["NDA (2027)", "SP+ (2027)", "Did Not Vote"],
      matrix: {
        "NDA (2022)": {
          "NDA (2027)": { origin: "NDA (2022)", destination: "NDA (2027)", origin_share: 78.5, destination_share: 82.0, joint_share: 32.0 },
          "SP+ (2027)": { origin: "NDA (2022)", destination: "SP+ (2027)", origin_share: 12.0, destination_share: 10.0, joint_share: 5.0 },
          "Did Not Vote": { origin: "NDA (2022)", destination: "Did Not Vote", origin_share: 9.5, destination_share: 15.0, joint_share: 4.0 },
        },
        "SP+ (2022)": {
          "NDA (2027)": { origin: "SP+ (2022)", destination: "NDA (2027)", origin_share: 8.0, destination_share: 6.0, joint_share: 3.0 },
          "SP+ (2027)": { origin: "SP+ (2022)", destination: "SP+ (2027)", origin_share: 85.0, destination_share: 84.0, joint_share: 28.0 },
          "Did Not Vote": { origin: "SP+ (2022)", destination: "Did Not Vote", origin_share: 7.0, destination_share: 12.0, joint_share: 2.0 },
        },
        "Did Not Vote": {
          "NDA (2027)": { origin: "Did Not Vote", destination: "NDA (2027)", origin_share: 15.0, destination_share: 12.0, joint_share: 3.0 },
          "SP+ (2027)": { origin: "Did Not Vote", destination: "SP+ (2027)", origin_share: 10.0, destination_share: 6.0, joint_share: 2.0 },
          "Did Not Vote": { origin: "Did Not Vote", destination: "Did Not Vote", origin_share: 75.0, destination_share: 73.0, joint_share: 15.0 },
        },
      },
    };

    it("renders origin on rows, destination on columns, highlights diagonal cells, and formats percentages", () => {
      render(
        <MantineProvider>
          <TransitionMatrixBody data={data} lens="origin_share" />
        </MantineProvider>
      );

      // Origins and destinations rendered
      expect(screen.getByText("NDA (2022)")).toBeInTheDocument();
      expect(screen.getByText("SP+ (2022)")).toBeInTheDocument();
      expect(screen.getByText("NDA (2027)")).toBeInTheDocument();
      expect(screen.getByText("SP+ (2027)")).toBeInTheDocument();

      // Formatted values (|v| >= 2.0 rounds to whole percentage)
      expect(screen.getByText("79%")).toBeInTheDocument(); // 78.5 -> 79%
      expect(screen.getByText("85%")).toBeInTheDocument();

      // Check diagonal retention highlight
      const diagonalCells = screen.getAllByTestId("diagonal-cell");
      expect(diagonalCells.length).toBe(3);
      expect(diagonalCells[0]).toHaveAttribute("data-diagonal", "true");
      expect(diagonalCells[0].style.borderWidth).toBe("2px");
      expect(diagonalCells[0].style.borderColor).toBe("var(--mb-primary)");
    });

    it("allows switching lenses using segmented control", async () => {
      render(
        <MantineProvider>
          <TransitionMatrixBody data={data} />
        </MantineProvider>
      );

      // Default lens is Flow Out: origin_share for NDA->NDA is 78.5% -> 79%
      expect(screen.getByText("79%")).toBeInTheDocument();

      // Click Joint %
      const jointButton = screen.getByText("Joint %");
      await userEvent.click(jointButton);

      // In joint_share, NDA->NDA is 32.0% -> 32%
      expect(screen.getByText("32%")).toBeInTheDocument();
    });
  });

  describe("CompositeGridBody", () => {
    it("renders CompositeTable with provided grid and rounds", () => {
      const grid: CellGrid = {
        rows: [{ key: "GEN", label: "General", colour: null }],
        columns: [{ key: "vote", label: "Vote Share", colour: null, sub: "%" }],
        cells: {
          GEN: {
            vote: {
              cell: { value: 42.0, delta: 1.5, trend: [40.5, 42.0], secondary: null, flags: [], base: 1200 },
              unit: "pct",
            },
          },
        },
        rowDim: "Category",
        columnDim: "Metric",
      };

      const rounds: RoundsBlock = {
        items: [{
          obs_id: "R2", label: "R2", base_name: "2027 VS R2", cycle: "2027",
          series: "VS", round: 2, dataset_id: "d1", version: "normal",
          fallback: false, seats: 403, borrowed: 0, seats_source: "metadata",
        }],
        groups: [],
        anchor: "R2",
        compare: null,
      };

      const onSort = vi.fn();

      render(
        <MantineProvider>
          <CompositeGridBody
            grid={grid}
            parts={["value", "delta"]}
            rounds={rounds}
            rule={{ kind: "none" }}
            sort={null}
            onSort={onSort}
          />
        </MantineProvider>
      );

      expect(screen.getByText("General")).toBeInTheDocument();
      expect(screen.getByText("Vote Share")).toBeInTheDocument();
      expect(screen.getByText("42%")).toBeInTheDocument();
    });
  });
});
