import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const fx = (name: string) => readFileSync(`src/test/fixtures/${name}.json`, "utf8");
const DONE: Record<string, string> = {
  "pulse.party_scoreboard": "run_scoreboard_done",
  "pulse.leaders": "run_leaders_done",
  "pulse.change_appetite": "run_change_appetite_done",
  "pulse.by_zone": "run_by_zone_done",
};
const R1 = "2027 VS CAPI R1";

test("context change runs State Pulse", async ({ page }) => {
  let runPosts = 0;
  const polled = new Set<string>();
  // Plans only gate unavailability, so every card reuses plan_scoreboard.
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, "");
    const json = (body: string) => route.fulfill({ contentType: "application/json", body });
    if (path === "/catalogue/states") return json(fx("states"));
    if (path.endsWith("/surveys")) return json(fx("surveys"));
    if (path.startsWith("/templates")) return json(fx("templates_pulse"));
    if (path === "/cards/plan") return json(fx("plan_scoreboard"));
    if (path === "/cards/run") {
      runPosts += 1;
      return json(JSON.stringify({ run_id: req.postDataJSON().card_id }));
    }
    if (path.startsWith("/runs/")) {
      const id = decodeURIComponent(path.slice("/runs/".length));
      if (!polled.has(id)) {
        polled.add(id);
        return json(fx("run_running"));
      }
      return json(fx(DONE[id] ?? "run_running"));
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"not found"}' });
  });

  await page.goto("/");
  await expect(page.getByText("Choose a state, survey level and rounds to begin.")).toBeVisible();

  await page.getByText("AC", { exact: true }).click();
  await page.getByRole("checkbox", { name: "R1" }).check();
  await page.getByRole("checkbox", { name: "R2" }).check();
  await page.getByRole("textbox", { name: "Compare" }).click();
  await page.getByRole("option", { name: R1 }).click();
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page).toHaveURL(/rounds=2027\+VS\+CAPI\+R1&rounds=2027\+VS\+CAPI\+R2/);

  const scoreboard = page.getByRole("table").first();
  await expect(scoreboard.getByRole("row", { name: /NDA/ })).toContainText("▼1.50%");
  await expect(page.getByRole("heading", { name: "Support by zone" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(4);

  const before = runPosts;
  await page.getByRole("button", { name: "⇄ Transpose" }).first().click();
  await expect(scoreboard.getByRole("columnheader").first()).toContainText("measure");
  expect(runPosts).toBe(before);

  await page.goBack();
  await expect(page.getByText("Choose a state, survey level and rounds to begin.")).toBeVisible();
});
