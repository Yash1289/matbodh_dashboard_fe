import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

type Json = Record<string, any>;
const fx = (path: string): Json => JSON.parse(readFileSync(`src/test/fixtures/${path}.json`, "utf8"));
const STANDALONE = fx("cards/distribution_standalone");
const FAMILIES = JSON.parse(readFileSync("src/test/fixtures/configure_families.json", "utf8")) as Json[];
const CONTEXT = "/?state=Uttar+Pradesh&level=ac&rounds=R1&rounds=R2&compare=R1&anchor=R2&version=extrapolated";

const field = (value: string, scope: string) => ({ value, label: value, kind: null, recalled: false, disabled_reason: null, scope });
const OPTIONS: Record<string, Json[]> = {
  scenarios: [{ value: "vs_voting_intention", label: "vs_voting_intention", kind: "party", recalled: false, disabled_reason: null }],
  fields: [field("age_group", "respondent"), field("gender", "respondent"), field("caste", "respondent"),
    field("party_zone", "seat"), field("ac_num", "seat")],
  parties: [],
};

async function serve(page: Page): Promise<Json[]> {
  const runs: Json[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const sent = (request.postDataJSON?.() ?? null) as Json | null;
    if (path === "/catalogue/states") return json(fx("states"));
    if (path.endsWith("/surveys")) return json(fx("surveys"));
    if (path === "/cards") return json([]);
    if (path === "/configure/families") return json(FAMILIES);
    if (path === "/configure/options") return json(OPTIONS[sent!.source] ?? []);
    if (path === "/cards/validate") return json({ valid: true, errors: [], unavailable: [], not_asked: [], notes: [], rounds: [] });
    if (path === "/cards/plan") {
      return json({ valid: true, errors: [], unavailable: [], not_asked: [], notes: [], coverage_mode: { grid: "independent" },
        rounds: STANDALONE.rounds.items.map(({ cycle: _c, series: _s, ...rest }: Json) => rest) });
    }
    if (path === "/cards/run") { runs.push(sent!.card); return json({ run_id: sent!.card.id }); }
    if (path.startsWith("/runs/")) return json({ state: "done", done: 1, total: 1, result: { ...STANDALONE, card_id: decodeURIComponent(path.replace("/runs/", "")) }, errors: {} });
    return json({ detail: "not found" }, 404);
  });
  return runs;
}

test("Split by: a View by seat and a nested cut write the tables the card reads", async ({ page }) => {
  const runs = await serve(page);
  await page.goto(CONTEXT);
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("menuitem", { name: /Party vote share/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "vs_voting_intention" }).check();

  await dialog.getByRole("combobox", { name: "Add a split" }).selectOption("age_group");
  await dialog.getByRole("combobox", { name: "Then split age_group by" }).selectOption("gender");
  await expect(dialog.getByText("age_group › gender")).toBeVisible();
  await expect(dialog.getByText(/Reads age_group, age_group × gender/)).toBeVisible();
  await expect(dialog.getByText("3 tables")).toBeVisible();

  await dialog.getByRole("combobox", { name: "View by seat" }).selectOption("party_zone");
  await expect(dialog.getByText(/One party zone at a time/)).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Add a split" }).locator('option[value="ac_num"]')).toHaveCount(0);
  if (process.env.SHOT_DIR) await dialog.getByRole("group", { name: "Split by" }).screenshot({ path: `${process.env.SHOT_DIR}/split-by.png` });

  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(runs[0].cuts).toEqual([
    ["party_zone"], ["party_zone", "age_group"], ["party_zone", "age_group", "gender"]]);
});
