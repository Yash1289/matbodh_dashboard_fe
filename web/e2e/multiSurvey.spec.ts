import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

type Json = Record<string, any>;
const fx = (path: string): Json => JSON.parse(readFileSync(`src/test/fixtures/${path}.json`, "utf8"));
const BASE = fx("cards/distribution_standalone");
const FAMILIES = JSON.parse(readFileSync("src/test/fixtures/configure_families.json", "utf8")) as Json[];
const CONTEXT = "/?state=Uttar+Pradesh&level=ac&rounds=R1&rounds=R2&compare=R1&anchor=R2&version=extrapolated";
const option = (value: string, kind: string | null = null) => ({ value, label: value, kind, recalled: false, disabled_reason: null });
const OPTIONS: Record<string, Json[]> = {
  scenarios: [option("vs_voting_intention", "party")], fields: [option("age_group")], parties: [option("NDA")],
  surveys: [option("R1"), option("R2")],
};

/** The standalone payload read over two surveys: R1's values are R2's minus 5, so a wrong row is visible. */
const TWO = (() => {
  const item = BASE.rounds.items[0];
  const cut = BASE.cuts[0];
  return {
    ...BASE,
    rounds: { ...BASE.rounds, anchor: "R2", items: [{ ...item, obs_id: "R1", label: "R1", base_name: "2027 VS CAPI R1", round: 1 }, item] },
    cuts: [{ ...cut, cells: [...cut.cells.map((c: Json) => ({ ...c, round: "R1", value: c.value - 5 })), ...cut.cells], bases: [] }],
  };
})();

async function serve(page: Page) {
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
    if (path === "/cards/validate") return json({ valid: (sent!.card.scenarios ?? []).length > 0, errors: [], unavailable: [], not_asked: [], notes: [], rounds: [] });
    if (path === "/cards/plan") return json({ valid: true, errors: [], unavailable: [], not_asked: [], notes: [], coverage_mode: { grid: "independent" }, rounds: [] });
    if (path === "/cards/run") { runs.push(sent!.card); return json({ run_id: sent!.card.id }); }
    if (path.startsWith("/runs/")) return json({ state: "done", done: 1, total: 1, result: { ...TWO, card_id: decodeURIComponent(path.replace("/runs/", "")) }, errors: {} });
    return json({ detail: "not found" }, 404);
  });
  return runs;
}

test("a card reads two surveys as rows, and flipping the axis sends no request", async ({ page }) => {
  const runs = await serve(page);
  await page.goto(CONTEXT);
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("menuitem", { name: /Party vote share/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "vs_voting_intention" }).check();
  await dialog.getByRole("checkbox", { name: "R1" }).click();
  await expect(dialog.getByRole("checkbox", { name: "R1" })).toBeChecked();
  await dialog.getByRole("checkbox", { name: "R2" }).click();
  await expect(dialog.getByRole("checkbox", { name: "R2" })).toBeChecked();
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  expect(runs[0].surveys).toEqual(["R1", "R2"]);
  const table = page.getByRole("table");
  await expect(table).toHaveCount(1);
  await expect(table.getByText("R1", { exact: true }).first()).toBeVisible();
  await expect(table.getByText("R2", { exact: true }).first()).toBeVisible();
  const sent = runs.length;
  await page.getByRole("button", { name: /^Card actions/ }).click(); // opens and closes: display only
  await page.keyboard.press("Escape");
  expect(runs.length).toBe(sent);
});
