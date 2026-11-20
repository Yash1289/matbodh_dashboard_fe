import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { seedCards } from "./seed";

type Json = Record<string, any>;
const fx = (path: string): Json => JSON.parse(readFileSync(`src/test/fixtures/${path}.json`, "utf8"));
const FAMILIES = fx("configure_families") as unknown as Json[];

const STANDALONE = fx("cards/distribution_standalone");
const COMPARE = fx("cards/opinion_compare");
const TREND = fx("cards/distribution_trend");
const PAYLOADS: Record<string, Json> = Object.fromEntries([STANDALONE, COMPARE, TREND].map((p) => [p.card_id, p]));
const CONTEXT = "/?state=Uttar+Pradesh&level=ac&rounds=R1&rounds=R2&compare=R1&anchor=R2&version=extrapolated";

const infoOf = (p: Json) => ({
  id: p.card_id, family: p.family, section: "cards", title: `Card ${p.card_id}`, scenarios: [], cuts: [], filters: [],
  comparison: { mode: p.mode, target: null, reference: null, delta_measures: [] },
  caste_clubbing: false, requires: { min_level: "state" }, meta: p.meta,
});

/** The analyst has each payload's card on their canvas; the card keeps the fixture's id so its run is found. */
const seed = (page: Page, payloads: Record<string, Json>) =>
  seedCards(page, "Uttar Pradesh", Object.values(payloads).map((p) => {
    const { meta: _meta, ...config } = infoOf(p);
    return { id: p.card_id, config };
  }));

/** Serves the cards API from the fixture payloads; `calls` records every API request. */
async function serve(page: Page, payloads: Record<string, Json> = PAYLOADS): Promise<string[]> {
  const calls: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    calls.push(`${request.method()} ${path}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const sent = request.postDataJSON?.() as { card_id?: string; card?: { id: string } } | null;
    const body = { card_id: sent?.card_id ?? sent?.card?.id };
    if (path === "/catalogue/states") return json(fx("states"));
    if (path.endsWith("/surveys")) return json(fx("surveys"));
    if (path === "/cards") return json(Object.values(payloads).map(infoOf));
    // The cards on the canvas are the analyst's own: their family metadata comes from here (the payload's, where the fixture has one).
    if (path === "/configure/families") return json(FAMILIES.map((d) => ({ ...d, meta: Object.values(payloads).find((p) => p.family === d.family)?.meta ?? d.meta })));
    if (path === "/cards/plan") {
      // The context bar plans a card of its own, which is not one of the cards on the page.
      const p = payloads[body.card_id!] ?? STANDALONE;
      return json({
        valid: true, errors: [], unavailable: [], not_asked: [], coverage_mode: { grid: "independent" },
        rounds: p.rounds.items.map(({ cycle: _c, series: _s, ...rest }: Json) => rest),
      });
    }
    if (path === "/cards/run") return json({ run_id: body.card_id });
    if (path.startsWith("/runs/")) {
      const id = decodeURIComponent(path.replace("/runs/", ""));
      return json({ state: "done", done: 1, total: 1, result: payloads[id], errors: {} });
    }
    return json({ detail: "not found" }, 404);
  });
  return calls;
}

// Percentage-point lenses show signed values.
const SIGNED = /^[+−-]\d/;
const card = (page: Page, p: Json) => page.getByTestId(`card:${p.card_id}`);
const lensOf = (id: string) => (STANDALONE.meta.lenses as Json[]).find((l) => l.id === id)!;

test("the cards journey", async ({ page }) => {
  const calls = await serve(page);
  await seed(page, PAYLOADS);
  await page.goto(CONTEXT);

  // Three cards, one per fixture.
  await expect(page.getByRole("table")).toHaveCount(3);
  const requestsAfterLoad = calls.length;
  const dist = card(page, STANDALONE);

  // Lens: the unit and the values change, and nothing is requested.
  const firstCell = dist.locator("tbody td").first();
  const before = await firstCell.innerText();
  await dist.getByRole("button", { name: /^Lens:/ }).click();
  await page.getByRole("dialog").getByText(lensOf("size_of_impact_pp").label, { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dist.getByRole("button", { name: new RegExp(`^Lens: ${lensOf("size_of_impact_pp").label}`) })).toBeVisible();
  await expect(firstCell).not.toHaveText(before);
  await expect(dist.locator("tbody td").first()).toContainText(SIGNED);

  // Transpose swaps rows and columns; the lens stays.
  const firstRow = await dist.locator("tbody th").first().innerText();
  await dist.getByRole("button", { name: /Transpose/ }).click();
  await expect(dist.getByRole("columnheader").filter({ hasText: firstRow.split("\n")[0] })).toHaveCount(1);
  await expect(dist.getByRole("button", { name: new RegExp(`^Lens: ${lensOf("size_of_impact_pp").label}`) })).toBeVisible();
  await expect(dist.locator("tbody td").first()).toContainText(SIGNED);
  await dist.getByRole("button", { name: /Transpose/ }).click();

  // Diverging format shows its legend.
  await dist.getByRole("button", { name: /^Format/ }).click();
  await page.getByRole("dialog").getByText("Diverging on value", { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dist.getByText(/Diverging on value/)).toBeVisible();

  // Switching the cut changes the rows, again without a request.
  const rowsBefore = await dist.locator("tbody th").allInnerTexts();
  await dist.getByText("category · gender", { exact: true }).click();
  await expect.poll(async () => (await dist.locator("tbody th").allInnerTexts()).join("|")).not.toBe(rowsBefore.join("|"));

  // Trend: pipes and no delta.
  const trend = card(page, TREND);
  await expect(trend.locator("[data-segment]").first()).toBeVisible();
  await expect(trend.locator("[data-tone]")).toHaveCount(0);

  // Compare: the value with its engine delta, and the reference round named once.
  const compare = card(page, COMPARE);
  await expect(compare.locator("[data-tone]").first()).toBeVisible();
  await expect(compare.getByRole("table").getByText(/Δ vs 2027 VS CAPI R1/)).toBeVisible();

  expect(calls.length).toBe(requestsAfterLoad);

  // The method drawer carries the contract from the payload.
  await dist.getByRole("button", { name: /^View/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "How this was calculated" }).click();
  await expect(page.getByRole("dialog").getByText("Contract")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Keyboard: Tab moves along the strip, Enter opens a chip, Escape closes it and focus returns to the chip.
  const chip = compare.getByRole("button", { name: /^Format/ }).first();
  await chip.focus();
  await page.keyboard.press("Tab");
  await expect(compare.getByRole("button", { name: /^Sort/ })).toBeFocused();
  await chip.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByText("None", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").locator(":focus")).toHaveCount(1); // the focus trap has taken over
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(chip).toBeFocused();
});

const SEAT_TREND = fx("cards/ranked_seat_trend");
const DEMOGRAPHIC = fx("cards/ranked_demographic_standalone");
const RANKED_PAYLOADS: Record<string, Json> = Object.fromEntries(
  [SEAT_TREND, DEMOGRAPHIC].map((p) => [p.card_id, p]));

test("the ranking cards journey", async ({ page }) => {
  const calls = await serve(page, RANKED_PAYLOADS);
  await seed(page, RANKED_PAYLOADS);
  await page.goto(CONTEXT);

  await expect(page.getByRole("table")).toHaveCount(2);
  const seat = card(page, SEAT_TREND);
  await expect(seat.locator("[data-rank]").first()).toBeVisible();
  await expect(card(page, DEMOGRAPHIC).getByText("AC 1", { exact: true })).toBeVisible();
  const requestsAfterLoad = calls.length;

  // Keyboard: Enter opens the Sort chip, a later round's rank reorders the rows, Escape returns focus.
  const sort = seat.getByRole("button", { name: /^Sort/ });
  await sort.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").getByRole("combobox", { name: "Sort" }).selectOption("o1:rank:asc");
  await page.keyboard.press("Escape");
  await expect(sort).toBeFocused();
  await expect(seat.locator("tbody th").first()).not.toContainText("Seat 128");

  expect(calls.length).toBe(requestsAfterLoad); // no request after any control change
});

test("table text stays readable on a narrow window", async ({ page }) => {
  await serve(page);
  await seed(page, PAYLOADS);
  await page.setViewportSize({ width: 820, height: 800 });
  await page.goto(CONTEXT);
  await expect(page.getByRole("table")).toHaveCount(3);
  const sizes = await page.locator("tbody td, thead th").evaluateAll((cells) => cells.map((c) => parseFloat(getComputedStyle(c).fontSize)));
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  const notes = await page.locator("tbody small").evaluateAll((cells) => cells.map((c) => parseFloat(getComputedStyle(c).fontSize)));
  for (const size of notes) expect(size).toBeGreaterThanOrEqual(11);
});
