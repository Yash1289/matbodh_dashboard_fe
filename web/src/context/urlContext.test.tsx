import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { StateContext } from "../api/types";
import { parseContext, serialiseContext, useDashboardContext } from "./urlContext";

const full: StateContext = {
  state: "Uttar Pradesh",
  level: "ac",
  rounds: ["2027 VS CAPI REBEL R1", "2022 R2", "2022 R1"],
  compare_round: "2022 R2",
  anchor_round: "2022 R1",
  version_mode: "matched",
  geo_scope: "state",
};

describe("urlContext", () => {
  it("round-trips a full context", () => {
    expect(parseContext(serialiseContext(full))).toEqual(full);
  });

  it("missing rounds gives null", () => {
    expect(parseContext(new URLSearchParams("state=UP&level=ac"))).toBeNull();
  });

  it("missing state or level gives null", () => {
    expect(parseContext(new URLSearchParams("level=ac&rounds=R1"))).toBeNull();
    expect(parseContext(new URLSearchParams("state=UP&rounds=R1"))).toBeNull();
  });

  it("invalid level gives null", () => {
    expect(parseContext(new URLSearchParams("state=UP&level=bad&rounds=R1"))).toBeNull();
  });

  it("unknown version falls back to extrapolated", () => {
    const ctx = parseContext(new URLSearchParams("state=UP&level=pc&rounds=R1&version=zzz"));
    expect(ctx?.version_mode).toBe("extrapolated");
    expect(ctx?.compare_round).toBeNull();
    expect(ctx?.anchor_round).toBeNull();
  });

  it("unrelated params preserved", () => {
    const out = serialiseContext(full, new URLSearchParams("tab=x&state=old&rounds=stale"));
    expect(out.get("tab")).toBe("x");
    expect(out.get("state")).toBe(full.state);
    expect(out.getAll("rounds")).toEqual(full.rounds);
  });

  it("values with spaces and plus signs survive", () => {
    const ctx = { ...full, state: "A+B State", rounds: ["2027 VS CAPI REBEL R1", "R+1"] };
    const qs = serialiseContext(ctx).toString();
    expect(parseContext(new URLSearchParams(qs))).toEqual(ctx);
  });

  it("useDashboardContext pushes history entries", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={["/?state=UP&level=ac&rounds=R1"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>
    );
    const { result } = renderHook(
      () => ({ dash: useDashboardContext(), loc: useLocation() }),
      { wrapper },
    );
    expect(result.current.dash.ctx?.state).toBe("UP");
    act(() => result.current.dash.setCtx({ ...full, state: "Bihar" }));
    expect(result.current.dash.ctx?.state).toBe("Bihar");
    expect(result.current.loc.search).toContain("state=Bihar");
  });
});
