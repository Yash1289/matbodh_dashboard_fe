import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GridPayload } from "../api/types";
import { LayoutSelectors } from "./LayoutSelectors";

const cell = (round: string) => ({ row: "x", column: "q:NDA", round, lens: "l", value: 1, status: "available" });
const payload = (dims: string[]) => ({
  mode: "standalone", rounds: { anchor: "B", items: [{ obs_id: "A", label: "Round A", base_name: "A" }, { obs_id: "B", label: "Round B", base_name: "B" }] },
  columns: [{ key: "q:NDA", label: "NDA", scenario: "q", kind: "party", colour: null, lenses: null }],
  cuts: [{ id: "g0", dimensions: dims, rows: [], cells: [cell("A"), cell("B")], deltas: [], bases: [] }],
}) as unknown as GridPayload;

describe("LayoutSelectors", () => {
  it("offers a survey selector for a cut over several surveys and reports the choice without any request", async () => {
    const onView = vi.fn();
    render(<MantineProvider><LayoutSelectors payload={payload(["age"])} cut="g0" view={{}} onView={onView} /></MantineProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Survey: Round A/ }));
    await user.click(await screen.findByRole("radio", { name: "Round B" }));
    expect(onView).toHaveBeenCalledWith({ survey: "B" });
  });

  it("draws nothing for an overall table", () => {
    const { container } = render(<MantineProvider><LayoutSelectors payload={payload([])} cut="g0" view={{}} onView={vi.fn()} /></MantineProvider>);
    expect(container.querySelector("button")).toBeNull();
  });
});
