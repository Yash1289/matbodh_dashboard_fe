import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const fx = (name: string) => readFileSync(`src/test/fixtures/${name}.json`, "utf8");

const UNIVERSAL_TEMPLATES = [
  {
    cell: ["value", "delta"],
    density: "standard",
    id: "pulse.by_zone_lens",
    measures: ["support_share", "contribution_share", "size_of_impact_pp"],
    operation: "distribution",
    body_adapter: "composite_grid",
    lenses: {
      default: "support_share",
      options: ["support_share", "contribution_share", "size_of_impact_pp"],
    },
    slicers: [
      {
        dimension: "party_zone",
        label: "Zone",
        options: ["All Zones", "West", "East"],
        selected: "All Zones",
      },
    ],
    presentationRules: {
      rowOrder: ["West", "East"],
      columnOrder: ["NDA", "SP"],
    },
    questions: ["vs_voting_intention"],
    requires: {
      focus_party: false,
      min_level: "ac",
    },
    section: "pulse",
    slices: ["party_zone"],
    title: "Zone Distribution",
  },
  {
    cell: ["value"],
    density: "standard",
    id: "pulse.battleground_shifts",
    measures: ["flips"],
    operation: "battleground",
    body_adapter: "battleground_summary",
    questions: [],
    requires: {
      focus_party: false,
      min_level: "ac",
    },
    section: "pulse",
    slices: [],
    title: "Battleground Shifts",
  },
];

const PLAN_SCOREBOARD = fx("plan_scoreboard");

const RUN_BY_ZONE_LENS = {
  card_id: "pulse.by_zone_lens",
  operation: "distribution",
  state: "Uttar Pradesh",
  rounds: {
    items: [
      {
        obs_id: "o1",
        label: "R1",
        base_name: "2027 VS CAPI R1",
        cycle: "2027",
        series: "VS",
        round: 1,
        dataset_id: "ds1",
        version: "extrapolated",
        fallback: false,
        seats: 403,
        borrowed: 0,
        seats_source: "metadata",
      },
      {
        obs_id: "o2",
        label: "R2",
        base_name: "2027 VS CAPI R2",
        cycle: "2027",
        series: "VS",
        round: 2,
        dataset_id: "ds1",
        version: "extrapolated",
        fallback: false,
        seats: 403,
        borrowed: 0,
        seats_source: "metadata",
      },
    ],
    groups: [],
    anchor: "o2",
    compare: "o1",
  },
  unavailable: [],
  not_asked: [],
  coverage: [],
  rules_version: "1",
  engine_version: "0.8.0",
  metadata_revision: 1,
  alliance_epoch: 1,
  hidden_count: 0,
  grid: {
    row_dim: "party_zone",
    rows: [
      {
        value: "West",
        label: "West Zone",
        series: [
          {
            series: "NDA",
            label: "NDA",
            colour: "#ff9933",
            cell: { value: 42.0, delta: 3.2, trend: [], secondary: null, flags: [], base: null },
            lenses: {
              support_share: { value: 42.0, delta: 3.2, trend: [], secondary: null, flags: [], base: null },
              contribution_share: { value: 18.0, delta: 1.5, trend: [], secondary: null, flags: [], base: null },
              size_of_impact_pp: { value: 5.4, delta: 0.8, trend: [], secondary: null, flags: [], base: null },
            },
          },
          {
            series: "SP",
            label: "SP",
            colour: "#228b22",
            cell: { value: 31.0, delta: -1.2, trend: [], secondary: null, flags: [], base: null },
            lenses: {
              support_share: { value: 31.0, delta: -1.2, trend: [], secondary: null, flags: [], base: null },
              contribution_share: { value: 12.0, delta: -0.5, trend: [], secondary: null, flags: [], base: null },
              size_of_impact_pp: { value: -2.1, delta: -0.3, trend: [], secondary: null, flags: [], base: null },
            },
          },
        ],
      },
      {
        value: "East",
        label: "East Zone",
        series: [
          {
            series: "NDA",
            label: "NDA",
            colour: "#ff9933",
            cell: { value: 38.0, delta: 1.1, trend: [], secondary: null, flags: [], base: null },
            lenses: {
              support_share: { value: 38.0, delta: 1.1, trend: [], secondary: null, flags: [], base: null },
              contribution_share: { value: 15.0, delta: 0.9, trend: [], secondary: null, flags: [], base: null },
              size_of_impact_pp: { value: 3.2, delta: 0.4, trend: [], secondary: null, flags: [], base: null },
            },
          },
          {
            series: "SP",
            label: "SP",
            colour: "#228b22",
            cell: { value: 35.0, delta: -0.4, trend: [], secondary: null, flags: [], base: null },
            lenses: {
              support_share: { value: 35.0, delta: -0.4, trend: [], secondary: null, flags: [], base: null },
              contribution_share: { value: 14.0, delta: -0.2, trend: [], secondary: null, flags: [], base: null },
              size_of_impact_pp: { value: -1.1, delta: -0.1, trend: [], secondary: null, flags: [], base: null },
            },
          },
        ],
      },
    ],
  },
};

const RUN_BATTLEGROUND = {
  card_id: "pulse.battleground_shifts",
  operation: "battleground",
  state: "Uttar Pradesh",
  rounds: {
    items: [
      {
        obs_id: "o2",
        label: "R2",
        base_name: "2027 VS CAPI R2",
        cycle: "2027",
        series: "VS",
        round: 2,
        dataset_id: "ds1",
        version: "extrapolated",
        fallback: false,
        seats: 403,
        borrowed: 0,
        seats_source: "metadata",
      },
    ],
    groups: [],
    anchor: "o2",
    compare: null,
  },
  unavailable: [],
  not_asked: [],
  coverage: [],
  rules_version: "1",
  engine_version: "0.8.0",
  metadata_revision: 1,
  alliance_epoch: 1,
  hidden_count: 0,
  battleground: {
    flips: { winning_both: 120, gain: 45, loss: 30, losing_both: 208 },
    margin_buckets: [
      { bucket: "< 2%", count: 18, seat_ids: ["AC-045", "AC-046"] },
      { bucket: "2% - 5%", count: 27, seat_ids: ["AC-088"] },
    ],
    seats: [
      { seat_id: "Meerut Cantt (AC-045)", winner: "NDA", margin_pp: 1.4, flip: "gain" },
      { seat_id: "Aligarh City (AC-046)", winner: "NDA", margin_pp: 0.8, flip: "gain" },
      { seat_id: "Varanasi South (AC-088)", winner: "SP", margin_pp: 3.2, flip: "loss" },
    ],
  },
};

const DONE_MAP: Record<string, unknown> = {
  "pulse.by_zone_lens": RUN_BY_ZONE_LENS,
  "pulse.battleground_shifts": RUN_BATTLEGROUND,
};

async function stubUniversalCard(page: Page) {
  let runCardCalls = 0;
  const polled = new Set<string>();

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, "");
    const json = (data: unknown) =>
      route.fulfill({
        contentType: "application/json",
        body: typeof data === "string" ? data : JSON.stringify(data),
      });

    if (path === "/catalogue/states") return json(fx("states"));
    if (path.endsWith("/surveys")) return json(fx("surveys"));
    if (path.startsWith("/templates")) return json(UNIVERSAL_TEMPLATES);
    if (path === "/cards/plan") return json(PLAN_SCOREBOARD);
    if (path === "/cards/run") {
      runCardCalls += 1;
      const cardId = req.postDataJSON()?.card_id;
      return json({ run_id: cardId });
    }
    if (path.startsWith("/runs/")) {
      const id = decodeURIComponent(path.slice("/runs/".length));
      if (!polled.has(id)) {
        polled.add(id);
        return json(fx("run_running"));
      }
      const result = DONE_MAP[id];
      if (result) {
        return json({ state: "done", done: 1, total: 1, result, errors: {} });
      }
      return json(fx("run_running"));
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"not found"}' });
  });

  return () => runCardCalls;
}

const DASHBOARD_URL =
  "/pulse?state=Uttar+Pradesh&level=ac&rounds=2027+VS+CAPI+R1&rounds=2027+VS+CAPI+R2&anchor_round=2027+VS+CAPI+R2&compare_round=2027+VS+CAPI+R1&version_mode=extrapolated&geo_scope=state";

test.describe("Universal Card Component End-to-End User Journeys", () => {
  test("multi-measure lens toggling, transpose, format switching, and slicer operate in-memory with zero network calls", async ({
    page,
  }) => {
    const getRunCalls = await stubUniversalCard(page);
    await page.goto(DASHBOARD_URL);

    // Verify initial cards render
    await expect(page.getByRole("heading", { name: "Zone Distribution" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Battleground Shifts" })).toBeVisible();

    const zoneCard = page.locator("div").filter({ hasText: /^Zone Distribution/ }).first();
    const table = zoneCard.getByRole("table");

    // 1. The Engine Owns Every Number: Assert initial default lens formatted outputs (Support %)
    await expect(table.getByRole("row", { name: /West Zone/ })).toContainText("42%");
    await expect(table.getByRole("row", { name: /West Zone/ })).toContainText("31%");
    await expect(table.getByRole("row", { name: /East Zone/ })).toContainText("38%");
    await expect(table.getByRole("row", { name: /East Zone/ })).toContainText("35%");

    const initialRunCalls = getRunCalls();
    expect(initialRunCalls).toBeGreaterThan(0);

    // 2. Multi-measure lens switching in-memory: Switch to Contribution %
    const lensChip = zoneCard.getByRole("button", { name: /Lens: Support %/ });
    await expect(lensChip).toBeVisible();
    await lensChip.click();

    await page.getByText("Contribution %", { exact: true }).click();

    // Assert formatted output updated in-memory to 18% and 12%
    await expect(table.getByRole("row", { name: /West Zone/ })).toContainText("18%");
    await expect(table.getByRole("row", { name: /West Zone/ })).toContainText("12%");
    await expect(zoneCard.getByRole("button", { name: /Lens: Contribution %/ })).toBeVisible();
    // Zero API Refetching on Display Controls
    expect(getRunCalls()).toBe(initialRunCalls);

    // Switch to Net Impact (pp)
    await page.getByText("Net Impact (pp)", { exact: true }).click();

    // Assert formatted output updated in-memory to Net Impact (+5% and −2%)
    await expect(table.getByRole("row", { name: /West Zone/ })).toContainText("+5%");
    await expect(table.getByRole("row", { name: /West Zone/ })).toContainText("−2%");
    await expect(zoneCard.getByRole("button", { name: /Lens: Net Impact \(pp\)/ })).toBeVisible();
    expect(getRunCalls()).toBe(initialRunCalls);

    // Switch back to Support %
    await page.getByText("Support %", { exact: true }).click();
    await expect(table.getByRole("row", { name: /West Zone/ })).toContainText("42%");
    expect(getRunCalls()).toBe(initialRunCalls);

    // Close lens popover
    await page.keyboard.press("Escape");

    // 3. Transpose (⇄ Transpose)
    const transposeBtn = zoneCard.getByRole("button", { name: "⇄ Transpose" });
    await expect(transposeBtn).toBeVisible();

    // Before transpose: column headers are NDA, SP; row headers are West Zone, East Zone
    await expect(table.getByRole("columnheader", { name: "NDA" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "SP" })).toBeVisible();

    await transposeBtn.click();
    await expect(transposeBtn).toHaveAttribute("aria-pressed", "true");

    // After transpose: headers inverted; column headers are West Zone, East Zone; rows are NDA, SP
    await expect(table.getByRole("columnheader", { name: "West Zone" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "East Zone" })).toBeVisible();
    await expect(table.getByRole("row", { name: /NDA/ })).toContainText("42%");
    expect(getRunCalls()).toBe(initialRunCalls);

    // Revert transpose
    await transposeBtn.click();
    await expect(transposeBtn).toHaveAttribute("aria-pressed", "false");
    await expect(table.getByRole("columnheader", { name: "NDA" })).toBeVisible();
    expect(getRunCalls()).toBe(initialRunCalls);

    // 4. Format switching (Heatmap vs Diverging vs None)
    const formatChip = zoneCard.getByRole("button", { name: "Format ▾" });
    await formatChip.click();

    await page.getByText("Heat on value", { exact: true }).click();
    expect(getRunCalls()).toBe(initialRunCalls);

    // Switch to None
    await page.getByText("None", { exact: true }).click();
    expect(getRunCalls()).toBe(initialRunCalls);

    // Close format popover
    await page.keyboard.press("Escape");

    // 5. Slicer filter interaction ([ Zone: ... ▾ ])
    const slicerChip = zoneCard.getByRole("button", { name: "Zone: All Zones ▾" });
    await expect(slicerChip).toBeVisible();
    await slicerChip.click();

    // Select West
    await page.getByText("West", { exact: true }).click();

    // Chip updates and only West Zone row is displayed
    await expect(zoneCard.getByRole("button", { name: "Zone: West ▾" })).toBeVisible();
    await expect(table.getByRole("row", { name: /West Zone/ })).toBeVisible();
    await expect(table.getByRole("row", { name: /East Zone/ })).not.toBeVisible();
    expect(getRunCalls()).toBe(initialRunCalls);

    // Reset Slicer to All Zones
    await page.getByText("All Zones", { exact: true }).click();

    await expect(zoneCard.getByRole("button", { name: "Zone: All Zones ▾" })).toBeVisible();
    await expect(table.getByRole("row", { name: /West Zone/ })).toBeVisible();
    await expect(table.getByRole("row", { name: /East Zone/ })).toBeVisible();
    expect(getRunCalls()).toBe(initialRunCalls);

    // Close slicer popover
    await page.keyboard.press("Escape");
  });

  test("slide-over Investigation Drawer opens from battleground card and dismisses with Escape and close button", async ({
    page,
  }) => {
    const getRunCalls = await stubUniversalCard(page);
    await page.goto(DASHBOARD_URL);

    await expect(page.getByRole("heading", { name: "Battleground Shifts" })).toBeVisible();
    const bgCard = page.locator("div").filter({ hasText: /^Battleground Shifts/ }).first();

    // Verify flip KPI metrics on Battleground card
    await expect(bgCard.getByText("Held (120)")).toBeVisible();
    await expect(bgCard.getByText("Gain (+45)")).toBeVisible();
    await expect(bgCard.getByText("Lost (-30)")).toBeVisible();

    const investigateBtn = bgCard.getByRole("button", { name: /Investigate gained seats/i });
    await expect(investigateBtn).toBeVisible();

    const callsBeforeDrawer = getRunCalls();

    // 1. Click CTA to open Investigation Drawer
    await investigateBtn.click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Investigating: 45 Gained Seats")).toBeVisible();
    await expect(drawer.getByText("Total Seats")).toBeVisible();
    await expect(drawer.getByText("45", { exact: true })).toBeVisible();

    // Verify seat roster entries in drawer
    await expect(drawer.getByText("Meerut Cantt (AC-045)")).toBeVisible();
    await expect(drawer.getByText("Aligarh City (AC-046)")).toBeVisible();

    // 2. Search filtering within the drawer seat roster
    const searchInput = drawer.getByPlaceholder("Search seats by name or number…");
    await searchInput.fill("Meerut");

    await expect(drawer.getByText("Meerut Cantt (AC-045)")).toBeVisible();
    await expect(drawer.getByText("Aligarh City (AC-046)")).not.toBeVisible();

    // Clear search
    await searchInput.clear();
    await expect(drawer.getByText("Aligarh City (AC-046)")).toBeVisible();

    // Search by AC number
    await searchInput.fill("046");
    await expect(drawer.getByText("Aligarh City (AC-046)")).toBeVisible();
    await expect(drawer.getByText("Meerut Cantt (AC-045)")).not.toBeVisible();

    // 3. Dismiss with Escape key
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // 4. Re-open and dismiss with close button
    await investigateBtn.click();
    await expect(drawer).toBeVisible();

    const closeBtn = drawer.getByRole("button", { name: "Close drawer" });
    await closeBtn.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Investigation drawer actions operated purely on pre-computed cohort data
    expect(getRunCalls()).toBe(callsBeforeDrawer);
  });
});
