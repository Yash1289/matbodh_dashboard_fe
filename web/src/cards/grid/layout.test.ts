import { describe, expect, it } from "vitest";
import type { GridPayload } from "../../api/types";
import { layoutNeeds, layoutPayload } from "./layout";
import { payloadToGrid } from "./payloadToGrid";

/** Two surveys (A, B) x two questions (q1, q2) x parties NDA / SP, every value distinct so a wrong pivot fails. */
function payload(cutDims: string[], questions = ["q1", "q2"], surveys = ["A", "B"]): GridPayload {
  const columns = questions.flatMap((q) => ["NDA", "SP"].map((p) => ({
    key: `${q}:${p}`, label: p, scenario: q, kind: "party" as const, colour: null, lenses: null,
  })));
  const rows = cutDims.length ? ["x", "y"] : ["overall"];
  const cells = surveys.flatMap((s, si) => rows.flatMap((r, ri) => columns.map((c, ci) => ({
    row: r, column: c.key, round: s, lens: "support_share", value: 100 * (si + 1) + 10 * (ri + 1) + ci, status: "available",
  }))));
  return {
    family: "distribution", card_id: "c", mode: "standalone", state: "UP",
    rounds: { anchor: surveys[surveys.length - 1], items: surveys.map((s) => ({ obs_id: s, label: `Round ${s}`, base_name: s })) },
    meta: { family: "distribution", lenses: [{ id: "support_share", label: "Share", unit: "percentage", has_delta: false }],
      default_lens: "support_share", capabilities: { modes: ["standalone"], transpose: true, sort: true, details: true } },
    columns,
    cuts: [{ id: "g0", dimensions: cutDims, rows: rows.map((r) => ({ key: r, labels: cutDims.length ? { d: r } : {}, subtotal: [] })),
      cells, deltas: [], bases: [] }],
    unavailable: [], not_asked: [], coverage: [], provenance: { contract: {}, resolved_datasets: null },
    hidden_count: 0, rules_version: 1, engine_version: "t", metadata_revision: 1, alliance_epoch: 1,
  } as unknown as GridPayload;
}
const grid = (p: GridPayload, view = {}) => payloadToGrid(layoutPayload(p, "g0", view), { lens: "support_share", cut: "g0" });
const value = (g: ReturnType<typeof grid>, row: string, col: string) => g.cells[row][col].cell?.value;

describe("layoutPayload", () => {
  it("one survey and one question is left untouched", () => {
    const p = payload([], ["q1"], ["A"]);
    expect(layoutPayload(p, "g0", {})).toBe(p);
  });

  it("one question across surveys, overall: a row per survey, values copied from that survey", () => {
    const g = grid(payload([], ["q1"]));
    expect(g.rows.map((r) => r.label)).toEqual(["Round A", "Round B"]);
    expect(value(g, "A", "q1:NDA")).toBe(110);
    expect(value(g, "B", "q1:SP")).toBe(211);
  });

  it("a cut with several surveys shows only the chosen survey", () => {
    const p = payload(["d"], ["q1"]);
    expect(layoutNeeds(p, "g0")).toMatchObject({ survey: true, question: false });
    const a = grid(p, { survey: "A" });
    const b = grid(p, { survey: "B" });
    expect(value(a, "x", "q1:NDA")).toBe(110);
    expect(value(b, "x", "q1:NDA")).toBe(210);
  });

  it("a cut with several questions makes one question the filter", () => {
    const p = payload(["d"], ["q1", "q2"], ["A"]);
    expect(layoutNeeds(p, "g0")).toMatchObject({ question: true });
    const g = grid(p, { question: "q2" });
    expect(g.columns.map((c) => c.key)).toEqual(["q2:NDA", "q2:SP"]);
    expect(value(g, "x", "q2:NDA")).toBe(112);
  });

  it("several questions across several surveys, overall: surveys x questions, one party's share", () => {
    const p = payload([]);
    expect(layoutNeeds(p, "g0").party).toBe(true);
    const g = grid(p, { party: "SP" });
    expect(g.rows.map((r) => r.label)).toEqual(["Round A", "Round B"]);
    expect(g.columns.map((c) => c.label)).toEqual(["q1", "q2"]);
    expect(value(g, "A", "q1:SP")).toBe(111);
    expect(value(g, "B", "q2:SP")).toBe(213);
  });

  it("trend and compare payloads are never re-laid out", () => {
    const p = { ...payload([], ["q1"]), mode: "trend" } as GridPayload;
    expect(layoutPayload(p, "g0", {})).toBe(p);
  });
});
