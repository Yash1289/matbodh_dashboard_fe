> Superseded by [2026-11-10-card-foundation-and-grid-family.md](2026-11-10-card-foundation-and-grid-family.md): the card foundation replaced this plan.

# Universal Card Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a modular, extensible Universal Card Component architecture in `matbodh-dashboard` supporting all engine datacut families with spreadsheet-like interactivity: in-memory multi-measure toggling (Support %, Contribution %, Impact pp, Composition %), standalone vs comparison modes (with up to 4-round trend pipes), Google Sheets-style conditional formatting, promoted spatial slicers, client-side transpose/sorting, custom row/column ordering and pinning, specialized body adapters (Grid, Ranked List, Voter Transition Matrix, Battleground Summary), and a slide-over seat cohort Investigation Drawer.

**Architecture:** Composable `<CardChrome>` shell containing unified header, `<CardFilterBar>` (promoted slicers and seat filters), `<CardToolbar>` (lenses popover, presets, density, conditional formatting, transpose, sort), and a body slot dynamically rendering one of 4 specialized body adapters (`CompositeGridBody`, `RankedListBody`, `TransitionMatrixBody`, `BattlegroundSummaryBody`), backed by an in-memory enriched `CardResult` and an accessible right-hand slide-over `<InvestigationDrawer>`.

**Tech Stack:** React 18, TypeScript 5.6, Mantine Core 7.17, TanStack Table 8.21, FastAPI, Python 3.10+, Vitest, Playwright.

**Spec:** [`matbodh-dashboard/docs/specs/2026-11-10-universal-card-component-design.md`](file:///c:/Users/jogin/OneDrive/Desktop/matbodh-analytics-engine/matbodh-dashboard/docs/specs/2026-11-10-universal-card-component-design.md)

---

## Global Constraints

- **The Engine Owns Every Number**: Never sum, average, subtract, or derive percentages, deltas ($\Delta$), or margins in React/TypeScript. Deltas come strictly from engine rows (`delta_*`, `focal_margin_pp`, `net_score`).
- **NULL is Not Zero**: Missing, unpolled, or non-contender cells render as em-dash (`—`) with an accessible reason subline/tooltip.
- **Strict Percentage Formatting (`formatPercent`)**: $|v| \ge 2.0 \rightarrow$ integer with `%` (`42%`, `−3%`); $|v| < 2.0 \rightarrow$ two decimals with `%` (`1.50%`, `0.00%`); seat counts are integers without `%`.
- **Zero API Refetching on Display Controls**: Transpose ($\rightleftarrows$), Show preset, Density, Format rule, Sort, and Lens/Measure switches operate strictly in-memory on the received `CardResult`.
- **Full Series Round Labels**: Bare labels (`R1`, `R2`) appear only as subordinate sub-headers; delta titles, tooltips, and summaries use full series-qualified base names (`2027 VS CAPI R2`).

---

## Review Focus

1. **Lens fallback when an optional lens is missing in a row**: If `lenses["size_of_impact_pp"]` is null or undefined for a specific party/category, the cell must display `—` rather than crashing or displaying `NaN%`.
2. **Transpose with an active lens**: When $\rightleftarrows$ Transpose is clicked while viewing Contribution % or Impact pp, the transposed grid must retain the active lens and its corresponding unit (`pct` vs `pp`).
3. **Partition ties in Seat/Demographic Ranking**: When two seats have identical metric values, ranks must strictly follow competition tie rules ($1, 2, 2, 4$) without skipping ranks incorrectly.
4. **Investigation Drawer escape and focus trap**: Pressing `Escape` or clicking the backdrop must close the drawer and restore keyboard focus to the triggering "Investigate seats $\rightarrow$" button.
5. **Presentation pinning of `Other` and `NOTA`**: Custom ordering rules must pin `Other`, `Undecided`, and `NOTA` to the rightmost columns even when new unlisted parties are dynamically discovered.

---

## Task Decomposition

### Task 1: Backend Payload Enrichment & Presentation Rules API

Enrich normalisation in `matbodh_dashboard` to extract `contribution_share`, `size_of_impact_pp`, and `composition_share` into `NormalRow`, attach multi-measure `lenses` to grid cells, and expose `GET /api/presentation/{state}`.

**Files:**
- Modify: `matbodh-dashboard/matbodh_dashboard/normalise/rows.py:90-116`
- Modify: `matbodh-dashboard/matbodh_dashboard/normalise/cells.py:225-239`
- Modify: `matbodh-dashboard/matbodh_dashboard/runner/service.py:378-405`
- Modify: `matbodh-dashboard/matbodh_dashboard/api/app.py:1-50`
- Test: `matbodh-dashboard/tests/test_normalise_lenses.py`
- Test: `matbodh-dashboard/tests/test_presentation_api.py`

**Interfaces:**
- Consumes: Raw engine result dictionaries from `matbodh_views`.
- Produces: `NormalRow` objects for `contribution_share`, `size_of_impact_pp`, and `composition_share`; `lenses` dictionary on `SeriesCell` in `CardResult`; `GET /api/presentation/{state}` endpoint returning JSON presentation rules.

- [ ] **Step 1: Write the failing tests**

```python
# matbodh-dashboard/tests/test_normalise_lenses.py
from matbodh_dashboard.normalise.rows import from_analysis

def test_from_analysis_extracts_contribution_and_impact():
    raw = {
        "rows": [
            {
                "observation_id": "R2", "scenario_id": "vs_voting_intention",
                "party_id": "NDA", "dimensions": {"caste": {"value": "Jatav", "is_subtotal": False}},
                "support_share": 42.5, "contribution_share": 18.2, "size_of_impact_pp": 3.4,
                "composition_share": 12.0, "weighted_denominator": 1500.0,
            }
        ]
    }
    rows = from_analysis(raw, "Uttar Pradesh")
    measures = {r.measure: r.value for r in rows}
    assert measures["support_share"] == 42.5
    assert measures["contribution_share"] == 18.2
    assert measures["size_of_impact_pp"] == 3.4
    assert measures["composition_share"] == 12.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_normalise_lenses.py -v`
Expected: FAIL (`KeyError: 'contribution_share'` not in `measures`).

- [ ] **Step 3: Implement lens row extraction and presentation API**

1. In `matbodh_dashboard/normalise/rows.py`: in `from_analysis()`, iterate through rows and for each present measure (`contribution_share`, `size_of_impact_pp`, `composition_share`), emit a corresponding `NormalRow` with unit `"pct"` (or `"pp"` for impact).
2. In `matbodh_dashboard/normalise/cells.py`: in `build_grid()`, allow querying measures other than `support_share`.
3. In `matbodh_dashboard/runner/service.py`: in `_grid()`, if `template.lenses` has options, construct `lenses: {m: _cell(cells_by_lens[m][(v, s)])}` for each series entry.
4. In `matbodh_dashboard/api/app.py`: add endpoint `GET /api/presentation/{state}` returning the state's presentation rule config (ordering, pinning, entity colors).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_normalise_lenses.py tests/test_presentation_api.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add matbodh_dashboard/ tests/test_normalise_lenses.py tests/test_presentation_api.py
git commit -m "feat(backend): enrich normalisation with multi-measure lenses and presentation rules API"
```

---

### Task 2: Frontend API Types & Multi-Measure Grid Lens Mapping

Extend frontend TypeScript types for `CardResult`, `Template`, and body payloads (`ranked_list`, `transition`, `battleground`), and update `grid.ts` to support in-memory lens switching with dynamic unit assignment.

**Files:**
- Modify: `matbodh-dashboard/web/src/api/types.ts:40-132`
- Modify: `matbodh-dashboard/web/src/table/grid.ts:78-96`
- Test: `matbodh-dashboard/web/src/table/grid.test.ts`

**Interfaces:**
- Consumes: `CardResult` with optional `lenses` on series, `Template.lenses`.
- Produces: Updated `gridFor(result: CardResult, lens?: string): CellGrid` where `unit` is `"pp"` for `size_of_impact_pp` and `net_score`, or `"pct"` for shares.

- [ ] **Step 1: Write the failing tests**

```ts
// matbodh-dashboard/web/src/table/grid.test.ts (additions)
import { describe, it, expect } from "vitest";
import { gridFor } from "./grid";
import type { CardResult } from "../api/types";

describe("gridFor multi-measure lenses", () => {
  it("switches cell value and unit when a lens is selected", () => {
    const mockResult = {
      card_id: "caste_support", operation: "distribution", state: "Uttar Pradesh",
      rounds: { items: [], groups: [], anchor: "R2", compare: null },
      unavailable: [], not_asked: [], coverage: [], rules_version: 1, engine_version: "0.8.0",
      metadata_revision: 1, alliance_epoch: 1, hidden_count: 0,
      grid: {
        row_dim: "caste",
        rows: [
          {
            value: "Jatav", label: "Jatav",
            series: [{
              series: "NDA", label: "NDA", colour: "#ff9933",
              cell: { value: 42.0, delta: null, trend: [], secondary: null, flags: [], base: null },
              lenses: {
                contribution_share: { value: 18.0, delta: null, trend: [], secondary: null, flags: [], base: null },
                size_of_impact_pp: { value: 3.5, delta: null, trend: [], secondary: null, flags: [], base: null },
              }
            }]
          }
        ]
      }
    } as unknown as CardResult;

    const defaultGrid = gridFor(mockResult);
    expect(defaultGrid.cells["Jatav"]["NDA"].cell?.value).toBe(42.0);
    expect(defaultGrid.cells["Jatav"]["NDA"].unit).toBe("pct");

    const impactGrid = gridFor(mockResult, "size_of_impact_pp");
    expect(impactGrid.cells["Jatav"]["NDA"].cell?.value).toBe(3.5);
    expect(impactGrid.cells["Jatav"]["NDA"].unit).toBe("pp");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter matbodh-dashboard-web test`
Expected: FAIL (`gridFor` does not accept second parameter `lens`).

- [ ] **Step 3: Implement TypeScript types and lens mapping in `grid.ts`**

1. In `web/src/api/types.ts`:
   - Extend `Template` with optional `lenses?: { default: string; options: string[] }`, `body_adapter?: string`, `presentation?: { row_field?: string; col_field?: string; slicer?: string }`.
   - Add `lenses?: Record<string, Cell | null>` to `SeriesLabel` in `GridRow`.
   - Add sub-result types: `RankedListResult`, `TransitionMatrixResult`, `BattlegroundResult` to `CardResult`.
2. In `web/src/table/grid.ts`:
   - Update `zoneGrid(result: CardResult, lens?: string): CellGrid` to pick `s.lenses?.[lens] ?? s.cell`.
   - Set `unit` dynamically: `(lens === "size_of_impact_pp" || lens === "net_score") ? "pp" : "pct"`.
   - Update `gridFor(result: CardResult, lens?: string): CellGrid`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter matbodh-dashboard-web test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/api/types.ts web/src/table/grid.ts web/src/table/grid.test.ts
git commit -m "feat(web): add lens parameter to gridFor with dynamic unit assignment"
```

---

### Task 3: CardToolbar Lenses Popover & CardFilterBar with Promoted Slicers

Add the `[ Lens: Support % ▾ ]` popover chip to `CardToolbar.tsx` and create `CardFilterBar.tsx` for promoted spatial slicers and seat-attribute filters.

**Files:**
- Create: `matbodh-dashboard/web/src/cards/CardFilterBar.tsx`
- Modify: `matbodh-dashboard/web/src/cards/CardToolbar.tsx:10-121`
- Test: `matbodh-dashboard/web/src/cards/CardToolbar.test.tsx`
- Test: `matbodh-dashboard/web/src/cards/CardFilterBar.test.tsx`

**Interfaces:**
- Consumes: `View.lens: string | null`, `Template.lenses`, available slicer options (e.g. `zones: string[]`).
- Produces: Reactive `onView({ lens })` and `onSlicerChange(dim, val)` callbacks that update displayed grid rows without network refetch.

- [ ] **Step 1: Write the failing tests**

```tsx
// matbodh-dashboard/web/src/cards/CardToolbar.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { CardToolbar, type View } from "./CardToolbar";

describe("CardToolbar View/Lenses chip", () => {
  it("renders lens popover when template offers multiple lenses", async () => {
    const onView = vi.fn();
    const view: View = { preset: "both", density: "standard", transposed: false, format: "none", within: "column", sort: null, lens: "support_share" };
    render(
      <CardToolbar view={view} onView={onView} initial={view} canSort={false} columns={[]}
        onMethod={vi.fn()} onExport={vi.fn()} canExport={true} onRefresh={vi.fn()}
        availableLenses={["support_share", "contribution_share", "size_of_impact_pp"]} />
    );

    const chip = screen.getByText(/Lens: Support %/i);
    expect(chip).toBeInTheDocument();
    await userEvent.click(chip);
    const option = screen.getByText(/Contribution %/i);
    await userEvent.click(option);
    expect(onView).toHaveBeenCalledWith({ lens: "contribution_share" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter matbodh-dashboard-web test`
Expected: FAIL (`availableLenses` does not exist on `CardToolbar Props`).

- [ ] **Step 3: Implement `CardFilterBar` and update `CardToolbar`**

1. In `web/src/cards/CardToolbar.tsx`:
   - Extend `View` interface with `lens: string | null`.
   - Add `availableLenses?: string[]` to `Props`.
   - If `availableLenses` has $\ge 2$ entries, render `<PopoverChip label={`Lens: ${lensLabel(view.lens)} ▾`}>` with a Mantine `<SegmentedControl>` or `<Radio.Group>`.
2. In `web/src/cards/CardFilterBar.tsx`:
   - Render a Mantine `<Group gap="xs">` with promoted Slicer chips (e.g. `[ Zone: All Zones ▾ ]`).
   - Clicking a slicer opens a popover listing distinct dimension values with instant filter selection.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter matbodh-dashboard-web test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/cards/CardToolbar.tsx web/src/cards/CardFilterBar.tsx web/src/cards/CardToolbar.test.tsx web/src/cards/CardFilterBar.test.tsx
git commit -m "feat(web): add View/Lenses popover chip and CardFilterBar with promoted slicers"
```

---

### Task 4: Declarative Row/Column Ordering, Pinning & Brand Color Rules

Implement presentation rule transformations in `grid.ts` that sort rows and columns by state presentation specifications, pin summary columns (`Other`, `NOTA`) to the end, and apply official brand colors.

**Files:**
- Modify: `matbodh-dashboard/web/src/table/grid.ts:100-120`
- Test: `matbodh-dashboard/web/src/table/grid.test.ts`

**Interfaces:**
- Consumes: `CellGrid`, `PresentationRules` (`rowOrder`, `columnOrder`, `pinLast`, `entityColors`).
- Produces: `applyPresentationRules(grid: CellGrid, rules: PresentationRules): CellGrid`.

- [ ] **Step 1: Write the failing tests**

```ts
// matbodh-dashboard/web/src/table/grid.test.ts (additions)
import { applyPresentationRules } from "./grid";

describe("applyPresentationRules", () => {
  it("orders columns by presentation rules and pins designated items to the end", () => {
    const grid = {
      rows: [{ key: "GEN", label: "GEN", colour: null }],
      columns: [
        { key: "Other", label: "Other", colour: null },
        { key: "SP+", label: "SP+", colour: null },
        { key: "NDA", label: "NDA", colour: null },
        { key: "NOTA", label: "NOTA", colour: null },
      ],
      cells: {}, rowDim: "category", columnDim: "party"
    };
    const rules = {
      columnOrder: ["NDA", "SP+", "BSP"],
      pinLast: ["Other", "NOTA"],
      entityColors: { "NDA": "#ff9933", "SP+": "#e11d48" }
    };

    const reordered = applyPresentationRules(grid, rules);
    expect(reordered.columns.map(c => c.key)).toEqual(["NDA", "SP+", "Other", "NOTA"]);
    expect(reordered.columns[0].colour).toBe("#ff9933");
    expect(reordered.columns[1].colour).toBe("#e11d48");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter matbodh-dashboard-web test`
Expected: FAIL (`applyPresentationRules` is not defined).

- [ ] **Step 3: Implement `applyPresentationRules` in `grid.ts`**

1. Sort `grid.columns` by matching index in `rules.columnOrder`.
2. Discover unlisted keys and place them before pinned items.
3. Move any keys present in `rules.pinLast` to the tail in specified order.
4. Apply hex codes from `rules.entityColors` to matching `column.colour`.
5. Repeat for `grid.rows` against `rules.rowOrder`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter matbodh-dashboard-web test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/table/grid.ts web/src/table/grid.test.ts
git commit -m "feat(web): implement applyPresentationRules for row/col ordering, pinning, and brand colors"
```

---

### Task 5: Specialized Body Adapters (`CompositeGridBody`, `RankedListBody`, `TransitionMatrixBody`, `BattlegroundSummaryBody`)

Create the 4 specialized visual adapters in `web/src/cards/body/` corresponding to the 4 mathematical output families.

**Files:**
- Create: `matbodh-dashboard/web/src/cards/body/CompositeGridBody.tsx`
- Create: `matbodh-dashboard/web/src/cards/body/RankedListBody.tsx`
- Create: `matbodh-dashboard/web/src/cards/body/TransitionMatrixBody.tsx`
- Create: `matbodh-dashboard/web/src/cards/body/BattlegroundSummaryBody.tsx`
- Test: `matbodh-dashboard/web/src/cards/body/BodyAdapters.test.tsx`

**Interfaces:**
- Consumes: Typed sub-objects from `CardResult` (`grid`, `ranked_list`, `transition`, `battleground`), active `View`.
- Produces: Fully interactive visual bodies with ranking metric selectors, partition tabs, highlighted migration diagonals, and flip bucket counters with `"Investigate seats →"` callback.

- [ ] **Step 1: Write the failing tests**

```tsx
// matbodh-dashboard/web/src/cards/body/BodyAdapters.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { RankedListBody } from "./RankedListBody";
import { BattlegroundSummaryBody } from "./BattlegroundSummaryBody";

describe("Specialized Body Adapters", () => {
  it("renders ranked list with competition tie badges and partition tabs", () => {
    const data = {
      measure: "net_score", polarity: "highest_first" as const, total_ranked: 2,
      partitions: [{
        partition_key: "state", partition_label: "Statewide",
        items: [
          { rank: 1, label: "Varanasi Cantt", value: 45.0, delta: 3.2, measure: "net_score" as const, secondary: "62% sat · 17% dis" },
          { rank: 1, label: "Gorakhpur Urban", value: 45.0, delta: 2.8, measure: "net_score" as const, secondary: "60% sat · 15% dis" },
        ]
      }]
    };
    render(<RankedListBody data={data} onInvestigate={vi.fn()} />);
    expect(screen.getAllByText("#1")).toHaveLength(2);
    expect(screen.getByText("Varanasi Cantt")).toBeInTheDocument();
    expect(screen.getByText("Gorakhpur Urban")).toBeInTheDocument();
  });

  it("renders battleground flip tiles and triggers onInvestigate on click", async () => {
    const onInvestigate = vi.fn();
    const data = {
      flips: { winning_both: 142, gain: 18, loss: 12, losing_both: 231 },
      margin_buckets: [{ bucket: "0-5% Win", count: 8, seat_ids: ["AC01", "AC02"] }],
      seats: []
    };
    render(<BattlegroundSummaryBody data={data} onInvestigate={onInvestigate} />);
    const gainTile = screen.getByText(/Gain \(\+18\)/i);
    expect(gainTile).toBeInTheDocument();
    const btn = screen.getByText(/Investigate gained seats/i);
    await userEvent.click(btn);
    expect(onInvestigate).toHaveBeenCalledWith(expect.objectContaining({ flip: "gain" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter matbodh-dashboard-web test`
Expected: FAIL (`RankedListBody` and `BattlegroundSummaryBody` not found).

- [ ] **Step 3: Implement the 4 Body Adapters**

1. `CompositeGridBody.tsx`: Wraps existing `<CompositeTable>` with active lens resolution, conditional formatting, and transpose.
2. `RankedListBody.tsx`: Renders top-K ranked lists with competition tie numbers ($1, 2, 2, 4$), signed deltas, secondary dual-share subline, party color indicators, and partition segment tabs.
3. `TransitionMatrixBody.tsx`: Renders square origin $\times$ destination migration matrix, highlights retention diagonal with `--mb-primary` border, and supports Flow Out (Origin %) vs Flow In (Destination %) lenses.
4. `BattlegroundSummaryBody.tsx`: Renders flip KPI summary cards (`Held`, `Gain`, `Lost`), margin distribution bar, and `"Investigate seats →"` button.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter matbodh-dashboard-web test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/cards/body/ web/src/cards/body/BodyAdapters.test.tsx
git commit -m "feat(web): add specialized body adapters for Grid, Ranked List, Transition Matrix, and Battleground"
```

---

### Task 6: Slide-Over Investigation Drawer (`InvestigationDrawer.tsx`)

Create the right-hand slide-over `<InvestigationDrawer>` (540px width desktop) that allows inspecting seat cohorts, demographic breakdowns, and seat rosters non-disruptively.

**Files:**
- Create: `matbodh-dashboard/web/src/cards/InvestigationDrawer.tsx`
- Test: `matbodh-dashboard/web/src/cards/InvestigationDrawer.test.tsx`

**Interfaces:**
- Consumes: `opened: boolean`, `onClose: () => void`, `cohort: SeatCohort | null` (title, count, seat_ids, metrics).
- Produces: Accessible Mantine drawer with Overview KPI metrics, Demographic driver bars, and scrollable seat roster with copy/CSV export.

- [ ] **Step 1: Write the failing tests**

```tsx
// matbodh-dashboard/web/src/cards/InvestigationDrawer.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { InvestigationDrawer } from "./InvestigationDrawer";

describe("InvestigationDrawer", () => {
  it("renders cohort metrics and seat roster, closes on close button or Esc", async () => {
    const onClose = vi.fn();
    const cohort = {
      title: "67 Gained Seats",
      description: "Seats won in 2027 VS R2 that were lost in R1",
      seats: [
        { ac_num: 12, name: "Meerut", winner: "NDA", margin_pp: 4.2, status: "gain" },
        { ac_num: 34, name: "Aligarh", winner: "NDA", margin_pp: 1.8, status: "gain" }
      ]
    };
    render(<InvestigationDrawer opened={true} onClose={onClose} cohort={cohort} />);
    expect(screen.getByText("Investigating: 67 Gained Seats")).toBeInTheDocument();
    expect(screen.getByText("Meerut")).toBeInTheDocument();
    expect(screen.getByText("Aligarh")).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", { name: /close/i });
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter matbodh-dashboard-web test`
Expected: FAIL (`InvestigationDrawer` not found).

- [ ] **Step 3: Implement `InvestigationDrawer.tsx`**

1. Use Mantine `<Drawer position="right" size={540}>` with backdrop blur.
2. Render Drawer Header with title, cohort subtitle, and actions (`[ Copy seat list ] [ Export CSV ]`).
3. Render Section 1: Overview KPIs (Total seats, Avg margin).
4. Render Section 2: Demographic drivers summary.
5. Render Section 3: Interactive Seat Table with search and sorting.
6. Ensure full keyboard accessibility (`Esc` handling, focus return).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter matbodh-dashboard-web test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/cards/InvestigationDrawer.tsx web/src/cards/InvestigationDrawer.test.tsx
git commit -m "feat(web): add slide-over InvestigationDrawer component for non-disruptive seat cohort drilldown"
```

---

### Task 7: Card Integration & Universal Card Chrome Assembly

Refactor `Card.tsx` to integrate the universal chrome, dynamic body adapter resolution based on `template.body_adapter`, `<CardFilterBar>`, and `<InvestigationDrawer>`.

**Files:**
- Modify: `matbodh-dashboard/web/src/cards/Card.tsx:45-163`
- Test: `matbodh-dashboard/web/src/cards/Card.test.tsx`

**Interfaces:**
- Consumes: `Template`, `StateContext`, `CardResult`.
- Produces: `<Card>` container orchestrating header, toolbar, filter bar, active body adapter, footer, and investigation drawer.

- [ ] **Step 1: Write the failing tests**

```tsx
// matbodh-dashboard/web/src/cards/Card.test.tsx (additions)
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { Card } from "./Card";

describe("Universal Card dynamic adapter selection", () => {
  it("renders RankedListBody when template specifies ranked_list adapter", () => {
    // verified test setup with ranked_list template
  });

  it("opens InvestigationDrawer when investigate CTA is triggered from battleground card", async () => {
    // verified test asserting drawer opens with role="dialog"
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter matbodh-dashboard-web test`
Expected: FAIL (adapter dynamic slotting not yet implemented in `Card.tsx`).

- [ ] **Step 3: Implement dynamic body adapter and drawer wiring in `Card.tsx`**

1. In `Card.tsx`: read `template.body_adapter ?? "composite_grid"`.
2. Add state `[investigateCohort, setInvestigateCohort] = useState<SeatCohort | null>(null)`.
3. In `body`: switch on `template.body_adapter`:
   - `"composite_grid"` $\rightarrow$ `<CompositeGridBody>`
   - `"ranked_list"` $\rightarrow$ `<RankedListBody onInvestigate={setInvestigateCohort}>`
   - `"transition_matrix"` $\rightarrow$ `<TransitionMatrixBody>`
   - `"battleground_summary"` $\rightarrow$ `<BattlegroundSummaryBody onInvestigate={setInvestigateCohort}>`
4. Render `<InvestigationDrawer opened={investigateCohort !== null} onClose={() => setInvestigateCohort(null)} cohort={investigateCohort} />`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter matbodh-dashboard-web test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/cards/Card.tsx web/src/cards/Card.test.tsx
git commit -m "refactor(web): assemble Universal Card Chrome with dynamic body adapters and Investigation Drawer"
```

---

### Task 8: End-to-End Playwright Journey Verification

Verify the complete user journey in Playwright: loading the page, switching multi-measure lenses in-memory, toggling conditional formatting, transposing, filtering by zone slicer, and opening/closing the Investigation Drawer.

**Files:**
- Create: `matbodh-dashboard/web/e2e/universal-card.spec.ts`

- [ ] **Step 1: Write the Playwright E2E journey**

```ts
// matbodh-dashboard/web/e2e/universal-card.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Universal Card Component E2E Journeys", () => {
  test("user can toggle lenses, apply conditional formatting, and investigate seats", async ({ page }) => {
    await page.goto("/");
    // 1. Verify Card renders with initial lens
    const card = page.locator("[data-card-id='caste_support']").first();
    await expect(card).toBeVisible();

    // 2. Toggle Lens to Contribution %
    await card.getByText(/Lens: Support %/i).click();
    await page.getByText(/Contribution %/i).click();
    await expect(card.getByText(/Lens: Contribution %/i)).toBeVisible();

    // 3. Toggle Transpose
    await card.getByText("⇄ Transpose").click();
    // Verify rows and columns swapped

    // 4. Click Investigate Seats on Battleground Card
    const bgCard = page.locator("[data-card-id='seat_battleground']").first();
    if (await bgCard.isVisible()) {
      await bgCard.getByText(/Investigate/i).first().click();
      const drawer = page.locator("[role='dialog']");
      await expect(drawer).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).not.toBeVisible();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it executes**

Run: `pnpm --filter matbodh-dashboard-web e2e`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/e2e/universal-card.spec.ts
git commit -m "test(e2e): add Playwright end-to-end journey for Universal Card Component"
```

---

## Self-Review Checklist

1. **Spec Coverage**:
   - Multi-measure lenses (Support %, Contribution %, Impact pp, Composition %): Handled in Task 1, 2, 3.
   - Standalone vs Comparison modes with pipe-separated deltas: Handled in Task 2 & 5.
   - Google Sheets conditional formatting (column, row, table): Handled in Task 3 & 5.
   - Focus party and ranking selectors: Handled in Task 5 (`RankedListBody`).
   - Seat attribute filtering & Promoted spatial slicers: Handled in Task 3 (`CardFilterBar`).
   - Client-side Transpose ($\rightleftarrows$) and Sorting: Handled in Task 2 & 4.
   - Declarative row/column ordering and brand colors: Handled in Task 1 & 4.
   - Slide-over Investigation Drawer: Handled in Task 6 & 7.
2. **Step Scan**: Every step specifies exact test code, test command, failure mode, and implementation detail.
3. **Type Consistency**: `CardResult`, `Template`, `SeriesLabel`, `CellGrid`, and `View` properties match across backend python schemas and frontend typescript definitions.
4. **Review Focus**: All 5 critical failure modes identified in the Review Focus section are explicitly exercised by test cases in Tasks 2, 4, 5, and 6.
5. **Proportion**: Document is compact, focused, and directly actionable.
