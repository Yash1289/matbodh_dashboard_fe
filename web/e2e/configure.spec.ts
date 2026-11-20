import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

type Json = Record<string, any>;
const fx = (path: string): Json => JSON.parse(readFileSync(`src/test/fixtures/${path}.json`, "utf8"));

const STANDALONE = fx("cards/distribution_standalone");
const FAMILIES = JSON.parse(readFileSync("src/test/fixtures/configure_families.json", "utf8")) as Json[];
const CONTEXT = "/?state=Uttar+Pradesh&level=ac&rounds=R1&rounds=R2&compare=R1&anchor=R2&version=extrapolated";

const option = (value: string, kind: string | null = null) =>
  ({ value, label: value, kind, recalled: false, disabled_reason: null });
const OPTIONS: Record<string, Json[]> = {
  scenarios: [option("vs_voting_intention", "party")],
  fields: [option("age_group"), option("caste")],
  parties: [option("NDA"), option("Other")],
};

/**
 * Serves the whole API from fixtures: an empty card library (as in production), the configure
 * endpoints, and one payload for every card the analyst adds. `runs` records each card sent to /cards/run.
 */
async function serve(page: Page): Promise<{ runs: Json[]; validated: Json[] }> {
  const seen = { runs: [] as Json[], validated: [] as Json[] };
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
    if (path === "/cards/validate") {
      seen.validated.push(sent!.card);
      const ok = (sent!.card.scenarios ?? []).length > 0;
      return json({ valid: ok, errors: [], unavailable: ok ? [] : [{ reason: "Choose a question" }], not_asked: [], notes: [], rounds: [] });
    }
    if (path === "/cards/plan") {
      return json({
        valid: true, errors: [], unavailable: [], not_asked: [], notes: [], coverage_mode: { grid: "independent" },
        rounds: STANDALONE.rounds.items.map(({ cycle: _c, series: _s, ...rest }: Json) => rest),
      });
    }
    if (path === "/cards/run") {
      seen.runs.push(sent!.card);
      return json({ run_id: sent!.card.id });
    }
    if (path.startsWith("/runs/")) {
      const id = decodeURIComponent(path.replace("/runs/", ""));
      return json({ state: "done", done: 1, total: 1, result: { ...STANDALONE, card_id: id }, errors: {} });
    }
    return json({ detail: "not found" }, 404);
  });
  return seen;
}

test("an analyst adds, configures, applies and copies a card", async ({ page }) => {
  const seen = await serve(page);
  await page.goto(CONTEXT);

  // The shared library is empty: the first tab invites the first card.
  await expect(page.getByText(/This tab is empty/)).toBeVisible();
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("menuitem", { name: /Party vote share/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Party vote share" })).toBeVisible();
  // First open: the main fields only.
  await expect(dialog.getByText("Only respondents where")).toHaveCount(0);
  const apply = dialog.getByRole("button", { name: "Apply" });
  await expect(apply).toBeDisabled(); // no question chosen yet: the backend says so

  await dialog.getByRole("checkbox", { name: "vs_voting_intention" }).check();
  await expect(apply).toBeEnabled();

  // Caste clubbing only matters once caste is in a cut.
  await dialog.getByRole("button", { name: "More options" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Club small castes" })).toHaveCount(0);
  await dialog.getByRole("combobox", { name: "Add a cut" }).selectOption("caste");
  await expect(dialog.getByRole("checkbox", { name: "Club small castes" })).toBeVisible();

  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The card is placed and runs from its own config (no library id involved).
  await expect(page.getByRole("table")).toHaveCount(1);
  expect(seen.runs.length).toBeGreaterThan(0);
  expect(seen.runs[0]).toMatchObject({ family: "distribution", scenarios: ["vs_voting_intention"] });
  expect(seen.runs[0].cuts).toContainEqual(["caste"]);
  expect(seen.runs[0].id).not.toBe("draft");

  // Copy card: a second card appears, titled as a copy.
  await page.getByRole("button", { name: /^Card actions/ }).click();
  await page.getByRole("menuitem", { name: "Copy card" }).click();
  await expect(page.getByRole("table")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Party vote share (copy)" })).toBeVisible();
});
