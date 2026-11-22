import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { seedCards } from "./seed";

type Json = Record<string, any>;
const fx = (path: string): Json => JSON.parse(readFileSync(`src/test/fixtures/${path}.json`, "utf8"));
const FAMILIES = fx("configure_families") as unknown as Json[];
const BASE = fx("cards/distribution_standalone");
const CONTEXT = "/?state=Uttar+Pradesh&level=ac&rounds=R1&rounds=R2&compare=R1&anchor=R2&version=extrapolated";
const ID = "distribution.cascaded";

/** Two nested cuts (age group, then age group by gender) with a population share on every row. */
const PAYLOAD = (() => {
  const column = BASE.columns[0].key;
  const round = BASE.rounds.anchor;
  const row = (key: string, labels: Json) => ({ key, labels, subtotal: [] });
  const cell = (r: string, value: number) => ({ row: r, column, round, lens: "support_share", value, status: "available" });
  const ages = [["18-23", 40, 14.2], ["24-35", 41, 30.0]] as const;
  const kids = [["18-23", "Male", 42, 7.4], ["18-23", "Female", 38, 6.8], ["24-35", "Male", 43, 15.0]] as const;
  const parent = (a: string) => `age_group=${a}`;
  const child = (a: string, g: string) => `age_group=${a}|gender=${g}`;
  return {
    ...BASE, card_id: ID,
    meta: { ...BASE.meta, capabilities: { ...BASE.meta.capabilities, population: true } },
    columns: [BASE.columns[0]],
    cuts: [
      { id: "g0", dimensions: ["age_group"], rows: ages.map(([a]) => row(parent(a), { age_group: a })),
        cells: ages.map(([a, v]) => cell(parent(a), v)), deltas: [], bases: [],
        population: ages.map(([a, , p]) => ({ row: parent(a), value: p, status: "available" })) },
      { id: "g1", dimensions: ["age_group", "gender"], rows: kids.map(([a, g]) => row(child(a, g), { age_group: a, gender: g })),
        cells: kids.map(([a, g, v]) => cell(child(a, g), v)), deltas: [], bases: [],
        population: kids.map(([a, g, , p]) => ({ row: child(a, g), value: p, status: "available" })) },
    ],
  };
})();
PAYLOAD.cuts.reverse(); // the table shown first is age group by gender, the one Cascaded applies to

const CONFIG = {
  id: ID, family: "distribution", section: "cards", title: "Cascaded", scenarios: ["vs_voting_intention"],
  cuts: [["age_group"], ["age_group", "gender"]], filters: [],
  comparison: { mode: "standalone", target: null, reference: null, delta_measures: [] },
  caste_clubbing: false, requires: { min_level: "state" },
};

async function serve(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (path === "/catalogue/states") return json(fx("states"));
    if (path.endsWith("/surveys")) return json(fx("surveys"));
    if (path === "/cards") return json([]);
    if (path === "/configure/families") return json(FAMILIES.map((d) => ({ ...d, meta: PAYLOAD.meta })));
    if (path === "/configure/options") return json([]);
    if (path === "/cards/plan") {
      return json({ valid: true, errors: [], unavailable: [], not_asked: [], coverage_mode: { grid: "independent" },
        rounds: PAYLOAD.rounds.items.map(({ cycle: _c, series: _s, ...rest }: Json) => rest) });
    }
    if (path === "/cards/run") return json({ run_id: ID });
    if (path.startsWith("/runs/")) return json({ state: "done", done: 1, total: 1, result: PAYLOAD, errors: {} });
    return json({ detail: "not found" }, 404);
  });
}

test("nested cuts read as one tree with Pop % as the second column", async ({ page }) => {
  await serve(page);
  await seedCards(page, "Uttar Pradesh", [{ id: ID, config: CONFIG }]);
  await page.goto(CONTEXT);

  const card = page.getByTestId(`card:${ID}`);
  const rows = card.locator("tbody tr");
  await expect(rows).toHaveCount(5);
  await expect(card.locator("thead th").nth(1)).toContainText("Pop %");
  await expect(rows.nth(0)).toContainText("18-23");
  await expect(rows.nth(0).locator("td").first()).toContainText("14%");
  await expect(rows.nth(1)).toContainText("Male");
  await expect(rows.nth(2)).toContainText("Female");
  await expect(rows.nth(3)).toContainText("24-35");
  // Retrying assertions: the table settles once the field scopes load.
  await expect(rows.nth(0).locator("th span")).toHaveCSS("padding-left", "0px");
  await expect(rows.nth(1).locator("th span")).toHaveCSS("padding-left", "16px");
});
