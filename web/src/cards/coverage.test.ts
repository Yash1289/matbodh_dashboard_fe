import { describe, expect, it } from "vitest";
import type { CardResult, RunStatus, Template } from "../api/types";
import { gridFor } from "../table/grid";
import leadersJson from "../test/fixtures/run_leaders_done.json";
import scoreboardJson from "../test/fixtures/run_scoreboard_done.json";
import templatesJson from "../test/fixtures/templates_pulse.json";
import { coverageNote, excludedNote, flagLegend, isSeatCard, notAskedNote, partLabel } from "./coverage";

const res = (f: unknown): CardResult => (f as RunStatus).result!;
const SCOREBOARD = res(scoreboardJson);
const LEADERS = res(leadersJson);
const TEMPLATES = templatesJson as Template[];
const tpl = (id: string) => TEMPLATES.find((t) => t.id === id)!;

describe("coverage notes", () => {
  it("coverageNote marks Normal fallback", () => {
    expect(coverageNote(SCOREBOARD.rounds)).toBe(
      "2027 VS CAPI R1: 380 seats · Normal (no Extrapolated version) · 2027 VS CAPI R2: 403 seats · Extrapolated",
    );
  });

  it("excludedNote names rounds", () => {
    const r: CardResult = {
      ...SCOREBOARD,
      coverage: [
        ...SCOREBOARD.coverage,
        { job: "seats_ac_o2_o1", part: "seats_ac", coverage: { excluded_by_observation: { o1: [5, 9], o2: [] } } },
        // Same exclusion reported by a second job is not repeated.
        { job: "seats_pc_o2_o1", part: "seats_pc", coverage: { excluded_by_observation: { o1: [5, 9], x9: [1] } } },
      ],
    };
    expect(excludedNote(r)).toBe("2 seats excluded in 2027 VS CAPI R1 · 1 seats excluded in x9");
  });

  it("excludedNote tolerates string coverage and no exclusions", () => {
    expect(excludedNote(SCOREBOARD)).toBeNull();
  });

  it("notAskedNote uses part labels and base names", () => {
    expect(notAskedNote(LEADERS)).toBe("cm_satisfaction not asked in 2027 VS CAPI R1");
    expect(notAskedNote(SCOREBOARD)).toBeNull();
    const r = { ...SCOREBOARD, not_asked: [{ part: "gender_gap", rounds: ["A", "B"] }] };
    expect(notAskedNote(r)).toBe("Gender gap not asked in A, B");
  });

  it("partLabel prefers fixed labels, then row label, then id", () => {
    expect(partLabel("seats_pc", SCOREBOARD)).toBe("Seats PC");
    expect(partLabel("pm_satisfaction", LEADERS)).toBe("pm_satisfaction");
    expect(partLabel("unknown_q", null)).toBe("unknown_q");
  });

  it("flagLegend lists only present flags, known first", () => {
    expect(flagLegend(gridFor(SCOREBOARD))).toEqual([
      { glyph: "", reason: "No Δ available for this round pair" },
      { glyph: "?", reason: "common_seats" },
    ]);
  });

  it("isSeatCard for scoreboard and geographic slices only", () => {
    expect(isSeatCard(tpl("pulse.party_scoreboard"))).toBe(true);
    expect(isSeatCard(tpl("pulse.by_zone"))).toBe(true);
    expect(isSeatCard(tpl("pulse.leaders"))).toBe(false);
  });
});
