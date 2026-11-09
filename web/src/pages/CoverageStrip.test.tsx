import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";
import type { PlanResponse } from "../api/types";
import planJson from "../test/fixtures/plan_scoreboard.json";
import { CoverageStrip } from "./CoverageStrip";

const rounds = (planJson as unknown as PlanResponse).rounds;

describe("coverage strip", () => {
  it("lists each round and toggles matched", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<MantineProvider><CoverageStrip rounds={rounds} versionMode="extrapolated" level="ac" onToggleMatched={onToggle} /></MantineProvider>);
    expect(screen.getByText("R1: 380 seats · Normal (no Extrapolated version)")).toHaveAttribute("title", "2027 VS CAPI R1");
    expect(screen.getByText("R2: 403 seats · Extrapolated")).toBeInTheDocument();
    expect(screen.getByText("Applies to seat cards only")).toBeInTheDocument();
    const chip = screen.getByRole("button", { name: "Matched seats only" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await user.click(chip);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("shows the chip pressed in matched mode", () => {
    render(<MantineProvider><CoverageStrip rounds={rounds} versionMode="matched" level="pc" onToggleMatched={() => {}} /></MantineProvider>);
    expect(screen.getByRole("button", { name: "Matched seats only" })).toHaveAttribute("aria-pressed", "true");
  });

  it("is hidden at levels without versions", () => {
    render(<MantineProvider><CoverageStrip rounds={rounds} versionMode="extrapolated" level="state" onToggleMatched={() => {}} /></MantineProvider>);
    expect(screen.queryByText("Applies to seat cards only")).not.toBeInTheDocument();
  });
});
