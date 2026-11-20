import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { seedCards } from "./seed";

type Json = Record<string, any>;
const fx = (path: string): Json => JSON.parse(readFileSync(`src/test/fixtures/${path}.json`, "utf8"));
const FAMILIES = fx("configure_families") as unknown as Json[];

const SEAT = fx("cards/ranked_seat_trend");
const OVERALL = { ...fx("cards/distribution_standalone"), card_id: "distribution.overall_vote_share" };
const PAYLOADS: Record<string, Json> = Object.fromEntries([SEAT, OVERALL].map((p) => [p.card_id, p]));
const CONTEXT = "/?state=Uttar+Pradesh&level=ac&rounds=R1&rounds=R2&compare=R1&anchor=R2&version=extrapolated";

const infoOf = (p: Json) => ({
  id: p.card_id, family: p.family, section: "cards", title: `Card ${p.card_id}`, scenarios: [], cuts: [], filters: [],
  comparison: { mode: p.mode, target: null, reference: null, delta_measures: [] },
  caste_clubbing: false, requires: { min_level: "state" }, meta: p.meta ?? { family: p.family, lenses: [], default_lens: "", capabilities: { modes: ["standalone"], transpose: false, sort: true, details: true } },
});

async function serve(page: Page): Promise<Json[]> {
  const bodies: Json[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const body = (request.postDataJSON?.() ?? {}) as Json;
    const cardId = body.card_id ?? body.card?.id; // an analyst's own card is sent inline
    if (request.method() === "POST") bodies.push({ path, ...body });
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (path === "/catalogue/states") return json(fx("states"));
    if (path.endsWith("/surveys")) return json(fx("surveys"));
    if (path === "/cards") return json(Object.values(PAYLOADS).map(infoOf));
    // The cards on the canvas are the analyst's own: their family metadata comes from here (the payload's, where the fixture has one).
    if (path === "/configure/families") return json(FAMILIES.map((d) => ({ ...d, meta: Object.values(PAYLOADS).find((p) => p.family === d.family)?.meta ?? d.meta })));
    if (path === "/cards/plan") {
      const p = PAYLOADS[cardId] ?? OVERALL;
      return json({ valid: true, errors: [], unavailable: [], not_asked: [], coverage_mode: { grid: "independent" },
        rounds: p.rounds.items.map(({ cycle: _c, series: _s, ...rest }: Json) => rest) });
    }
    if (path === "/cards/run") return json({ run_id: cardId });
    if (path === "/cohorts/preview") return json({ run_id: "cohort-preview" });
    if (path === "/runs/cohort-preview") {
      return json({ state: "done", done: 1, total: 1, errors: {},
        result: { kind: "cohort_preview", seat_level: "ac", seat_ids: [3, 12, 57], count: 3 } });
    }
    if (path.startsWith("/runs/")) {
      return json({ state: "done", done: 1, total: 1, result: PAYLOADS[decodeURIComponent(path.replace("/runs/", ""))], errors: {} });
    }
    return json({ detail: "not found" }, 404);
  });
  return bodies;
}

test("the cohort journey: make a cohort from a ranking card, use it, reload, clear it", async ({ page }) => {
  const bodies = await serve(page);
  const { meta: _meta, ...seatConfig } = infoOf(SEAT); // the seat ranking card is on the analyst's canvas
  await seedCards(page, "Uttar Pradesh", [{ id: SEAT.card_id, config: seatConfig }]);
  await page.goto(CONTEXT);

  const seat = page.getByTestId(`card:${SEAT.card_id}`);
  await seat.getByRole("button", { name: "⋯" }).click();
  await page.getByRole("menuitem", { name: "Make cohort…" }).click();
  const dialog = page.getByRole("dialog", { name: "Make cohort" });
  await dialog.getByRole("textbox", { name: "Top N in each group" }).fill("3");
  await dialog.getByRole("button", { name: "Find seats" }).click();
  await expect(dialog.getByText("3 seats matched")).toBeVisible();
  await dialog.getByRole("button", { name: "Use as cohort" }).click();

  await expect(page).toHaveURL(/\/cohort\?/);
  await expect(page.getByRole("heading", { name: "Cohort" })).toBeVisible();
  await expect(page.getByTestId("cohort-pill")).toContainText("3 AC seats");
  await expect(page.getByRole("tab", { name: /^Cohort/ })).toHaveAttribute("aria-selected", "true"); // the sidebar sub-tab
  await expect(page.getByTestId(`card:${OVERALL.card_id}`)).toBeVisible();
  const run = bodies.filter((b) => b.path === "/cards/run").at(-1)!;
  expect(run.context.cohort.seat_ids).toEqual([3, 12, 57]);
  expect(new URL(page.url()).search).not.toContain("cohort");

  await page.reload(); // a reload in the same tab keeps the session cohort
  await expect(page.getByTestId("cohort-pill")).toContainText("3 AC seats");

  await page.getByRole("button", { name: "Clear cohort" }).first().click();
  await expect(page.getByText(/No cohort is active/)).toBeVisible();
});
