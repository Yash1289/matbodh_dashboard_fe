import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedCards } from "./seed";

type Json = Record<string, any>;
const fx = (path: string): Json => JSON.parse(readFileSync(`src/test/fixtures/${path}.json`, "utf8"));

const STANDALONE = fx("cards/distribution_standalone");
const FAMILIES = fx("configure_families") as unknown as Json[];
const STATE = "Uttar Pradesh";
const CONTEXT = "/?state=Uttar+Pradesh&level=ac&rounds=R1&rounds=R2&compare=R1&anchor=R2&version=extrapolated";
const GAP = 18; // tokens.layout.gap
const COLUMNS = 12;

const mine = (id: string, title: string) => ({
  id, config: { id, family: "distribution", title, scenarios: ["vs_voting_intention"], cuts: [[]] },
});

/** The whole API from fixtures: an empty library, the family list, and one payload for every card that runs. */
async function serve(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const sent = (request.postDataJSON?.() ?? null) as Json | null;
    if (path === "/catalogue/states") return json(fx("states"));
    if (path.endsWith("/surveys")) return json(fx("surveys"));
    if (path === "/cards") return json([]);
    if (path === "/configure/families") return json(FAMILIES);
    if (path === "/cards/plan") {
      return json({
        valid: true, errors: [], unavailable: [], not_asked: [], notes: [], coverage_mode: { grid: "independent" },
        rounds: STANDALONE.rounds.items.map(({ cycle: _c, series: _s, ...rest }: Json) => rest),
      });
    }
    if (path === "/cards/run") return json({ run_id: sent!.card.id });
    if (path.startsWith("/runs/")) {
      const id = decodeURIComponent(path.replace("/runs/", ""));
      return json({ state: "done", done: 1, total: 1, result: { ...STANDALONE, card_id: id }, errors: {} });
    }
    return json({ detail: "not found" }, 404);
  });
}

async function open(page: Page, width?: number): Promise<void> {
  if (width !== undefined) await page.setViewportSize({ width, height: 900 });
  await serve(page);
  await seedCards(page, STATE, [mine("c1", "Card One"), mine("c2", "Card Two")]);
  await page.goto(CONTEXT);
  await expect(page.getByRole("heading", { name: "Card One" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Card Two" })).toBeVisible();
}

/** A card's cell: the toolbar (drag handle, menu) and the card under it. */
const cell = (page: Page, id: string): Locator => page.getByTestId(`card:${id}`).locator("xpath=ancestor::*[@data-card-body]/..");
const box = async (l: Locator) => (await l.boundingBox())!;

async function menu(page: Page, id: string, item: string | RegExp): Promise<void> {
  await cell(page, id).getByRole("button", { name: /^Card actions/ }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** The saved items of the first tab, read from the browser's storage. */
const saved = (page: Page) => page.evaluate((state) => {
  const ws = JSON.parse(localStorage.getItem(`mb.workspace.${state}`) ?? "null");
  return ws?.tabs?.[0]?.items as { cardId: string; x: number; y: number; w: number; h: number }[] | undefined;
}, STATE);

/** The grid animates changes; wait until the element has stopped moving. */
async function settled(l: Locator): Promise<void> {
  let last = "";
  await expect.poll(async () => {
    const b = await box(l);
    const now = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`;
    const same = now === last;
    last = now;
    return same;
  }, { intervals: [300] }).toBe(true);
}

async function dragBy(page: Page, from: Locator, dx: number, dy: number): Promise<void> {
  const b = await box(from);
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 8 });
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

test("drag a card beside another and the layout survives a reload", async ({ page }) => {
  await open(page);
  // Make both half width from the menu, so one can sit beside the other.
  await menu(page, "c1", /Size: Medium/);
  await menu(page, "c2", /Size: Medium/);
  await settled(cell(page, "c1"));
  await settled(cell(page, "c2"));
  const one = await box(cell(page, "c1"));
  const twoBefore = await box(cell(page, "c2"));
  expect(twoBefore.y).toBeGreaterThan(one.y + one.height - 4); // below it

  await dragBy(page, cell(page, "c2").locator(".canvas-handle"), one.width + GAP, -(twoBefore.y - one.y));
  // The grid animates cards into place and the page may have scrolled: compare with a fresh look at the first card.
  await expect.poll(async () => {
    const [c1, c2] = [await box(cell(page, "c1")), await box(cell(page, "c2"))];
    return c2.x > c1.x + c1.width && Math.abs(c2.y - c1.y) < 4;
  }).toBe(true);
  expect((await saved(page))?.find((i) => i.cardId === "c2")).toMatchObject({ x: 6, y: 0 });
  const twoAfter = await box(cell(page, "c2"));
  const oneAfter = await box(cell(page, "c1"));

  await page.reload();
  await expect(page.getByRole("heading", { name: "Card Two" })).toBeVisible();
  await settled(cell(page, "c2"));
  const [c1, c2] = [await box(cell(page, "c1")), await box(cell(page, "c2"))];
  expect(c2.x).toBeGreaterThan(c1.x + c1.width); // still beside it
  expect(Math.abs(c2.y - c1.y)).toBeLessThan(4);
  expect(Math.abs(c2.x - c1.x - (twoAfter.x - oneAfter.x))).toBeLessThan(3);
});

test("resizing from the corner snaps to the column grid", async ({ page }) => {
  await open(page);
  await menu(page, "c1", /Size: Medium/);
  await settled(page.locator(".react-grid-item").filter({ has: page.getByTestId("card:c1") }));
  const grid = await box(page.locator(".react-grid-layout"));
  const column = (grid.width - GAP * (COLUMNS - 1)) / COLUMNS;
  const item = page.locator(".react-grid-item").filter({ has: page.getByTestId("card:c1") });
  await expect.poll(async () => (await box(item)).width).toBeLessThan(grid.width * 0.6); // the menu's resize has settled
  const before = await box(item);
  const handle = await box(item.locator(".react-resizable-handle-se"));
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2, { steps: 10 });
  await page.mouse.move(handle.x + handle.width / 2 + 160, handle.y + handle.height / 2, { steps: 10 });
  await page.mouse.up();
  // After the drop the width settles on a whole number of columns (plus the gaps between them).
  await expect.poll(async () => {
    const width = (await box(item)).width;
    const columns = (width + GAP) / (column + GAP);
    return width > before.width + 20 && Math.abs(columns - Math.round(columns)) < 0.05;
  }).toBe(true);
});

test("Size and Move from the menu change the saved layout without dragging", async ({ page }) => {
  await open(page);
  await menu(page, "c2", /Size: Small/);
  await menu(page, "c2", "Move right");
  await menu(page, "c2", "Move right");
  await expect(page.getByRole("status").filter({ hasText: /Moved to column/ }).first()).toBeAttached();
  await expect.poll(async () => (await saved(page))?.find((i) => i.cardId === "c2")).toMatchObject({ w: 4, x: 2 });
});

test("a second tab keeps its own cards, and deleting a tab with cards asks first", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "New tab" }).click();
  await expect(page.getByRole("tab", { name: "Tab 2" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/This tab is empty/)).toBeVisible();

  await page.getByRole("tab", { name: "Tab 1" }).click();
  await menu(page, "c1", "Move to tab: Tab 2");
  await expect(page.getByRole("heading", { name: "Card One" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Card Two" })).toBeVisible();

  await page.getByRole("tab", { name: "Tab 2" }).click();
  await expect(page.getByRole("heading", { name: "Card One" })).toBeVisible();

  await page.getByRole("button", { name: /Tab actions/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/1 card/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("tab", { name: "Tab 2" })).toBeVisible();

  await page.getByRole("button", { name: /Tab actions/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete tab" }).click();
  await expect(page.getByRole("tab", { name: "Tab 2" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Card Two" })).toBeVisible();
});

test("at a narrow width the cards are one column and cannot be dragged", async ({ page }) => {
  await open(page, 500);
  await expect(page.locator(".canvas-handle")).toHaveCount(0);
  const one = await box(cell(page, "c1"));
  const two = await box(cell(page, "c2"));
  expect(Math.abs(two.x - one.x)).toBeLessThan(2);
  expect(two.y).toBeGreaterThan(one.y + one.height - 4);
});

test("cards keep their content height after a tab change and after Fit all heights", async ({ page }) => {
  // Results arrive late, as they do from a real engine: the cards are skeletons first, then tables.
  await page.route("**/api/runs/**", async (route) => { await new Promise((r) => setTimeout(r, 700)); await route.fallback(); });
  await open(page, 1400);
  const content = async () => (await box(page.getByTestId("card:c1"))).height;
  await expect.poll(content).toBeGreaterThan(150);
  const natural = await content();
  const cellHeight = async () => (await box(cell(page, "c1"))).height;
  await expect.poll(cellHeight).toBeGreaterThan(natural);

  await page.getByRole("button", { name: "New tab" }).click();
  await expect(page.getByText(/This tab is empty/)).toBeVisible();
  await page.getByRole("tab", { name: "Tab 1" }).click();
  await expect(page.getByRole("heading", { name: "Card One" })).toBeVisible();
  await expect.poll(cellHeight, { timeout: 5000 }).toBeGreaterThan(natural);

  await page.getByRole("button", { name: "Fit all heights" }).click();
  await settled(cell(page, "c1"));
  expect(await cellHeight()).toBeGreaterThan(natural);
  expect((await box(page.getByTestId("card:c1"))).height).toBeCloseTo(natural, -1);
});

test("switching between two tabs that both hold cards keeps every card at its content height", async ({ page }) => {
  await page.route("**/api/runs/**", async (route) => { await new Promise((r) => setTimeout(r, 500)); await route.fallback(); });
  await open(page, 1400);
  await page.getByRole("button", { name: "New tab" }).click();
  await page.getByRole("tab", { name: "Tab 1" }).click();
  await menu(page, "c1", "Move to tab: Tab 2");
  const heights = async (id: string) => ({ card: (await box(page.getByTestId(`card:${id}`))).height, cell: (await box(cell(page, id))).height });
  for (const [tab, id] of [["Tab 1", "c2"], ["Tab 2", "c1"], ["Tab 1", "c2"], ["Tab 2", "c1"]] as const) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByTestId(`card:${id}`)).toBeVisible();
    await expect.poll(async () => { const h = await heights(id); return h.card > 150 && h.cell > h.card; }, { timeout: 6000 }).toBe(true);
  }
});

test("a copied card arrives with a short animation and is scrolled into view; other cards do not animate", async ({ page }) => {
  await open(page, 1400);
  const animation = (id: string) => cell(page, id).evaluate((e) => getComputedStyle(e).animationName);
  await menu(page, "c1", "Copy card");
  const fresh = page.locator("[data-fresh]");
  await expect(fresh).toHaveCount(1);
  expect(await fresh.evaluate((e) => getComputedStyle(e).animationName)).not.toBe("none");
  expect(await animation("c2")).toBe("none");
  await expect(fresh).toBeInViewport();
});
