# Card visual design build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the cards and the Configure panel to the approved mock-ups, and add the behaviours the mock-ups introduce (lens tabs-or-chip rule, fluid table text, pinned columns, seat selector, benchmark tabs, trend movement, grouped pickers).

**Architecture:** Display-only changes in `web/src`. The card payloads, engine requests and Configure descriptor logic do not change. Shared pieces come first (tokens, a table frame, the chip and View menu), then each card family adopts them, then Configure.

**Tech Stack:** React 18, TypeScript, Mantine 7, TanStack Query, Vitest with Testing Library, Playwright. CSS modules for container-query rules (as `context/ContextDialog.module.css` already does).

**Spec:** `docs/specs/2026-11-20-card-visual-design.md`. The mock-ups it lists in `docs/mockups/` are the visual reference. Read both before any task.

## Global Constraints

- Display controls never start an engine request (spec section 1). A task that adds view state adds it to `FamilyView`, `RankedView`, `BenchmarkView` or `RelationshipView`, never to the card config.
- Card size classes come from the card's own width (`useElementSize`), not the window: narrow below 420px, medium 420 to 719px, wide 720px and above.
- Lens (and the benchmark's four tables, and the relationship's two): tabs only when the card is wide and has three entries or fewer; otherwise a chip.
- Table text: base size `clamp(10.5px, 8px + .57cqw, 13px)` set on the table, every part sized in `em` from it. Table headers are `1em`, values `1.2em`, change figures `.88em`. Never below 10.5px.
- Narrow tables keep every column and scroll sideways, first column pinned, soft edge shadow only once scrolled.
- A control differing from its default shows the soft tint plus a dot; a control at its default is plain. Never colour alone.
- One focus style on every control: `box-shadow: 0 0 0 3px #2663eb40`. Text meets AA (4.5:1) on its own background.
- Colours (measured): muted `#5b6472`, gain `#0a6c41`, loss `#b42d2d`, primary `#2663eb`, primary ink `#1b4fc2`, soft `#eaf0ff`, soft line `#c4d4f8`, faint `#8a919c` (icons only).
- Seat selector rule (spec section 4): the first field of a crossed cut with `scope: "seat"` and at least one field after it becomes a selector; display only; only the first field.
- Never invent numbers, mappings or labels. A missing value renders as a dash with its reason.
- Commit explicit paths only. The user's uncommitted edits to `docs/specs/2026-11-08-dashboard-design.md`, and anything in `ContextBar`/`ContextDialog`, stay uncommitted unless a task names them.
- Verification for every task: `cd web && npm test`, `npm run typecheck`. Backend: `uv run pytest tests` from the repo root (plain `python -m pytest` lacks the dependencies).

## Review Focus

- A cut whose first field is a seat field but is the only field: stays plain rows, no selector (test in Task 5).
- A lens count of exactly three on a wide card shows tabs; four shows a chip; three on a narrow card shows a chip (Task 3).
- A seat with no valid result in the first round of a trend shows "Not ranked", then "new" (Task 6).
- A benchmark group with no figure for a party shows a dash, not zero (Task 8).
- A rule matching zero seats keeps "Use as cohort" disabled (Task 10).
- A disabled picker option is not selectable by keyboard or click and shows its reason (Task 12).

---

### Task 0: Branch and commit the backend `scope` change

**Files:**
- Modify (already edited, uncommitted): `matbodh_dashboard/cards/configure/options.py`, `tests/cards/test_configure_options.py`, `web/src/api/types.ts`
- Add (docs): `docs/specs/2026-11-20-card-visual-design.md`, `docs/plans/2026-11-20-card-visual-build.md`, `docs/mockups/*.html`

**Interfaces:**
- Produces: `OptionItem.scope: "seat" | "respondent" | null` (Python) and `scope?: "seat" | "respondent" | null` (TypeScript), set only for the `fields` source.

- [ ] **Step 1:** `git switch -c feat/card-visual-design`.
- [ ] **Step 2:** Run `uv run pytest tests/cards/test_configure_options.py -q`. Expected: all pass (this includes `test_fields_say_whether_they_describe_the_seat_or_the_respondent` and `test_only_fields_carry_a_scope`).
- [ ] **Step 3:** Commit two commits with explicit paths: the three code files as `feat: say whether a cut field describes the seat or the respondent`; the spec, this plan and `docs/mockups/` as `docs: card visual design spec, plan and mock-ups`.

### Task 1: Tokens in `theme.ts`

**Files:**
- Modify: `web/src/theme.ts`
- Test: `web/src/theme.test.ts` (create)

**Interfaces:**
- Produces: `tokens.color` gains `ink`, `softLine`, `faint`, `lossTint`, `gainTint`; `tokens.elevation = { card, popover, panel, lift }` (strings); `tokens.focusRing` (string); CSS variables `--mb-ink`, `--mb-soft-line`, `--mb-faint`, `--mb-gain-tint`, `--mb-loss-tint`, `--mb-ring`, `--mb-elev-card`, `--mb-elev-pop`, `--mb-elev-panel`. Existing keys keep their names; `muted`, `gain`, `loss`, `primarySoft` take the values in Global Constraints.

- [ ] **Step 1:** Write `theme.test.ts` with a local `contrast(fg, bg)` helper and these assertions: `contrast(tokens.color.muted, "#ffffff") >= 4.5`; `contrast(tokens.color.muted, tokens.color.headerBg) >= 4.5`; `contrast(tokens.color.gain, "#ecf5f1") >= 4.5`; `contrast(tokens.color.loss, "#f9eded") >= 4.5`; `contrast("#ffffff", tokens.color.primary) >= 4.5`; `contrast(tokens.color.ink, tokens.color.primarySoft) >= 4.5`. Also assert `cssVariablesResolver({}).variables["--mb-ring"]` equals `tokens.focusRing`.
- [ ] **Step 2:** Run `npx vitest run src/theme.test.ts`. Expected: FAIL (old muted and gain fail).
- [ ] **Step 3:** Update the token values and add the new ones; extend the resolver. `headerBg` becomes `#f6f7f9`.
- [ ] **Step 4:** Run the full web test suite. Expected: PASS, with any snapshot or colour assertion in existing tests updated to the new token (not to a literal).
- [ ] **Step 5:** Commit `web/src/theme.ts web/src/theme.test.ts` and any updated tests.

### Task 2: Table frame (fluid text, pinned first column)

**Files:**
- Create: `web/src/table/TableFrame.tsx`, `web/src/table/TableFrame.module.css`
- Test: `web/src/table/TableFrame.test.tsx`

**Interfaces:**
- Produces: `TableFrame({ children, minWidthEm?: number })` renders `<div class=scroller data-scrolled=false>` wrapping the table. The module CSS sets `container-type: inline-size`, `overflow-x: auto`, and `.scroller table { font-size: clamp(10.5px, 8px + .57cqw, 13px); }`. A `.pin` class (applied by callers to the first `th`/`td` of every row) is `position: sticky; left: 0` with the surface background, and `.scroller[data-scrolled=true] .pin` gets the edge shadow. `sizeClass(width: number): "narrow" | "medium" | "wide"` exported from `web/src/cards/sizeClass.ts` using the 420/720 thresholds.

- [ ] **Step 1:** Tests: `sizeClass` returns narrow at 419, medium at 420 and 719, wide at 720; `TableFrame` sets `data-scrolled="true"` after a scroll event with `scrollLeft = 5` and back to `"false"` at 0; `minWidthEm={38}` applies `min-width: 38em` to the child table.
- [ ] **Step 2:** Run the file; expect FAIL.
- [ ] **Step 3:** Implement `TableFrame` and `sizeClass.ts`.
- [ ] **Step 4:** Run the file; expect PASS. Run `npm run typecheck`.
- [ ] **Step 5:** Commit the four new files.

### Task 3: Chip system, View menu, lens presentation

**Files:**
- Modify: `web/src/cards/PopoverChip.tsx`, `web/src/cards/ControlStrip.tsx`, `web/src/cards/CardShell.tsx`
- Create: `web/src/cards/ViewMenu.tsx`
- Test: `web/src/cards/ControlStrip.test.tsx`, `web/src/cards/ViewMenu.test.tsx` (create)

**Interfaces:**
- Consumes: `sizeClass` (Task 2), tokens (Task 1).
- Produces: `chipStyle(selected)` now returns the tinted style and `PopoverChip` renders a leading dot when `selected`. `lensPresentation(count: number, size: "narrow" | "medium" | "wide"): "tabs" | "chip" | "none"` (none when count is 1 or fewer; tabs only when `size === "wide" && count <= 3`) exported from `ControlStrip.tsx`. `ViewMenu({ rows: { id: string; label: string; value: string; node: ReactNode }[]; changed: number })`: one chip labelled "View" with a count badge of `changed`, opening a popover listing each row with its current value. `ControlStrip` takes `size: "narrow" | "medium" | "wide"` in place of `narrow?: boolean`; at medium and narrow, Format moves into the View menu rows; secondary controls (cell parts, density, details, transpose, find and hide, how this was calculated, export) are always View rows.

- [ ] **Step 1:** Tests: `lensPresentation(3,"wide")==="tabs"`, `(4,"wide")==="chip"`, `(3,"medium")==="chip"`, `(3,"narrow")==="chip"`, `(1,"wide")==="none"`. `ControlStrip` with three lenses and `size="wide"` renders a `tablist` named "Lens" whose selected tab is the view's lens; with `size="narrow"` renders a chip button whose text includes "Lens". A chip at its default has no dot (`data-changed` absent); after `onView({ lens: other })` it has `data-changed="true"`. `ViewMenu` lists "Density" with value "Standard" and shows the count "1" when one row is changed.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. `CardShell` passes `size = sizeClass(width)`. Keep every existing control's `onView` patch exactly as is.
- [ ] **Step 4:** Run the web tests; fix the existing `ControlStrip.test.tsx` cases that assumed the `narrow` boolean. Expected: PASS.
- [ ] **Step 5:** Commit the touched files.

### Task 4: Grid card table

**Files:**
- Modify: `web/src/table/CompositeTable.tsx`, `web/src/cells/CompositeCell.tsx`, `web/src/table/formatRules.ts`, `web/src/cards/families/_grid/GridBody.tsx`
- Test: `web/src/table/CompositeTable.test.tsx`, `web/src/table/formatRules.test.ts`

**Interfaces:**
- Consumes: `TableFrame` (Task 2).
- Produces: heat and diverging colours are the gain and loss tokens at alpha no greater than 0.16 (a function `tint(tone: "gain" | "loss", strength: number): string` where strength is 0 to 1; the returned alpha is `0.04 + 0.12 * strength`). The table renders inside `TableFrame`; the first column cells carry `.pin`; all sizes are `em`.

- [ ] **Step 1:** Tests: `tint("gain", 1)` has alpha 0.16 and `tint("loss", 0)` alpha 0.04; a heat-formatted cell's background alpha never exceeds 0.16 for strengths 0, 0.5 and 1; `CompositeTable` first column cells have the `pin` class; header and first-column text are present for a two-column fixture.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. No change to `payloadToGrid` or sort and filter logic.
- [ ] **Step 4:** Run web tests. Expected: PASS.
- [ ] **Step 5:** Commit the touched files.

### Task 5: Seat selector

**Files:**
- Create: `web/src/cards/seatSelector.ts`, `web/src/cards/SeatSelector.tsx`
- Modify: `web/src/cards/view.ts`, `web/src/cards/ControlStrip.tsx`, `web/src/cards/families/_grid/GridBody.tsx`, `web/src/api/queries.ts` (a `useFieldScopes` hook if none exists)
- Test: `web/src/cards/seatSelector.test.ts`, `web/src/cards/SeatSelector.test.tsx`, `web/src/cards/view.test.ts`

**Interfaces:**
- Consumes: `OptionItem.scope` (Task 0); `GridPayload.cuts[].dimensions` (the cut's field names, in order) and its rows.
- Produces: `FamilyView.seat: string | null` (the chosen value of the cut's seat field; `null` means All). `seatSplit(dimensions: string[], scopes: Record<string, "seat" | "respondent" | null>): { field: string; rest: string[] } | null` returns a split only when `dimensions.length >= 2` and `scopes[dimensions[0]] === "seat"`. `SeatSelector({ field, values, value, onChange })` renders the stronger chip, previous and next buttons, a position label "n / N", and a searchable listbox with an "All" option shown only when `hasAll` is true. Default `seat`: `null` when the cut has an All row, else the first value (my call; the engine's subtotal availability is not confirmed for every cut).

- [ ] **Step 1:** Tests for `seatSplit`: `(["party_zone","gender"], {party_zone:"seat", gender:"respondent"})` gives `{field:"party_zone", rest:["gender"]}`; `(["ac_num"], {ac_num:"seat"})` gives `null`; `(["age_group","party_zone"], {age_group:"respondent", party_zone:"seat"})` gives `null`; `(["party_zone","incumbent_mla_party","gender"], …both seat…)` gives field `party_zone` and rest `["incumbent_mla_party","gender"]` (only the first becomes the selector). `SeatSelector`: next button advances the value and calls `onChange`; at the last value next is disabled; typing in search filters the list; with `hasAll` false there is no "All" option. `view.test.ts`: `settled` resets `seat` to its default when the chosen value is no longer in the payload, and `initialView` sets `seat` to `null` when there is an All row.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. `GridBody` filters the grid rows to the chosen seat value and drops the first dimension from the row labels. Changing `seat` never starts a request.
- [ ] **Step 4:** Run web tests; expect PASS.
- [ ] **Step 5:** Commit the touched files.

### Task 6: Seat ranking visuals and trend movement

**Files:**
- Modify: `web/src/cards/ranking/RankedTable.tsx`, `web/src/cards/ranking/RankingCard.tsx`, `web/src/cards/ranking/rankedRows.ts`
- Test: `web/src/cards/ranking/rankedRows.test.ts`, `web/src/cards/ranking/RankingCard.test.tsx`

**Interfaces:**
- Consumes: `TableFrame`, `ViewMenu`, `ControlStrip` size class.
- Produces: `movement(previous: number | null | undefined, current: number | null | undefined): { kind: "up" | "down" | "same" | "new" | "none"; by: number }`. `previous === undefined` (first round) gives `none`; `previous === null` with a current rank gives `new`; a lower rank number is `up`.

- [ ] **Step 1:** Tests: `movement(undefined, 2)` is `none`; `movement(null, 1)` is `new`; `movement(4, 2)` is `{kind:"up", by:2}`; `movement(2, 3)` is `{kind:"down", by:1}`; `movement(3, 3)` is `same`. `RankingCard` with the `ranked_seat_trend` fixture shows "Not ranked" for Seat 128 in R1 and a rank badge `1` with "new" in R2; rank badges for ranks 1 to 3 have the `top` class; each row shows the AC number beside the seat name.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement the rank badge, proportional bar (width proportional to the value within the shown rows), order chip, search, "Show N more", and the trend cell (badge, value, movement).
- [ ] **Step 4:** Run web tests; expect PASS.
- [ ] **Step 5:** Commit.

### Task 7: Demographic ranking groups

**Files:**
- Modify: `web/src/cards/ranking/RankedTable.tsx`
- Test: `web/src/cards/ranking/RankingCard.test.tsx`

- [ ] **Step 1:** Test with the `ranked_demographic_standalone` fixture: each seat renders one group header button (`aria-expanded="true"`) with a count; clicking it collapses that seat's rows and sets `aria-expanded="false"`; tied rank rows show "=1".
- [ ] **Step 2:** Run; expect FAIL if groups are not collapsible yet.
- [ ] **Step 3:** Implement collapsible groups. Collapse state is local display state.
- [ ] **Step 4:** Run; expect PASS. **Step 5:** Commit.

### Task 8: Seat benchmark tables

**Files:**
- Modify: `web/src/cards/benchmark/BenchmarkTables.tsx`, `web/src/cards/benchmark/BenchmarkCard.tsx`, `web/src/cards/benchmark/benchmarkRows.ts`
- Create: `web/src/cards/TableChooser.tsx` (tabs or chip by `lensPresentation`)
- Test: `web/src/cards/benchmark/benchmarkRows.test.ts`, `web/src/cards/benchmark/BenchmarkCard.test.tsx`

**Interfaces:**
- Consumes: `lensPresentation` (Task 3), `TableFrame`.
- Produces: `summaryMatrix(p: BenchmarkPayload): { parties: string[]; rows: { label: string; cells: Record<string, { voteShare: number | null; voteDelta: number | null; seats: number | null; seatDelta: number | null }> }[] }`; the first row is always the all-seats group; other groups follow in `groupedRows` order; a party with no comparison row for a group maps to nulls. `TableChooser({ value, options, onChange, size })`.

- [ ] **Step 1:** Tests from the `benchmark_survey_vs_2022` fixture: `summaryMatrix` row 0 is "All seats"; its NDA cell is `{ voteShare: 42.0658…, voteDelta: -1.7538…, seats: 154, seatDelta: -119 }` (rounded to the fixture values); a zone row lacking BSP has `null` cells. Rendered Summary shows "42.1%" and "154" in one cell with "▼ 1.8 pp" and "▼ 119". Margin buckets shows six bucket rows, and each side's total is 403. Seat flips shows 132, 22, 141 and 108. Comparison shows grouped headers "Vote share" and "Seats won". At `size="narrow"` the table chooser is a chip, at wide it is four tabs. The Reference chip is tinted when the reference is not "none".
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement the four tables and the chooser. The reference label appears once, in the Reference chip, not in cells. Margin rows say "Ahead" or "Behind" in words as well as colour.
- [ ] **Step 4:** Run web tests; expect PASS. **Step 5:** Commit.

### Task 9: Relationship card

**Files:**
- Modify: `web/src/cards/relationship/RelationshipCard.tsx`, `RelationshipMatrix.tsx`, `RelationshipSummary.tsx`
- Test: `web/src/cards/relationship/RelationshipCard.test.tsx`, `RelationshipTables.test.tsx`

- [ ] **Step 1:** Tests with `relationship_transition`: Summary and Matrix use `TableChooser` (two tabs when wide, one chip when narrow); the matrix's first column has `pin`; the diagonal cells carry a `data-diagonal` attribute; each cell's tint alpha rises with its share and never exceeds 0.4.
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Implement. Keep the group selector as a segmented control for two options. **Step 4:** Run; expect PASS. **Step 5:** Commit.

### Task 10: Make cohort flow

**Files:**
- Modify: `web/src/cohorts/CohortDialog.tsx`, `web/src/cards/ControlStrip.tsx` (menu item), `web/src/cards/ranking/RankingCard.tsx`, `web/src/cards/benchmark/BenchmarkCard.tsx`, `web/src/context/ContextBar.tsx` (cohort pill and clear control; this file has the user's uncommitted edits, so edit it surgically and commit only the hunks for the pill)
- Test: `web/src/cohorts/CohortDialog.test.tsx`, `web/src/cohorts/CohortIntegration.test.tsx`

- [ ] **Step 1:** Tests: the card menu on a seat ranking and a seat benchmark card has "Make cohort…"; the demographic ranking menu does not. The dialog first shows the card's own settings read-only, a rule control, and "Find seats"; "Use as cohort" appears only after a preview and stays disabled when the preview has zero seats; the ranking rule text says seats tied at the cut-off are included. The context bar shows the cohort label, its seat count and a "Clear cohort" button that clears the store.
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Implement as a restyle of the existing flow; the predicate building and preview polling are unchanged. **Step 4:** Run; expect PASS. **Step 5:** Commit.

### Task 11: Configure panel shell

**Files:**
- Modify: `web/src/configure/ConfigurePanel.tsx`, `web/src/configure/conditions.ts`
- Test: `web/src/configure/ConfigurePanel.test.tsx`, `web/src/configure/conditions.test.ts`

**Interfaces:**
- Produces: `compareGroup(fields: FieldDescriptor[]): FieldDescriptor[]` returns the visible fields whose `show_when` reads `comparison.mode` equal to `"compare"`, in descriptor order. The panel renders them inside a tinted block headed "Comparing two questions".

- [ ] **Step 1:** Tests: with `configure_families.json` distribution and `comparison.mode = "compare"`, `compareGroup` returns `comparison.target.scenario` and `comparison.reference.scenario`; with standalone it returns `[]`. The panel has no all-caps eyebrow; "More options" shows "n set" counting fields with a value; the footer says "Ready to apply" when valid and "1 thing to fix" with one error and a disabled Apply.
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Implement. **Step 4:** Run; expect PASS. **Step 5:** Commit.

### Task 12: Pickers

**Files:**
- Create: `web/src/configure/widgets/OptionPicker.tsx`
- Modify: `web/src/configure/widgets/ChoiceField.tsx`, `CutBuilder.tsx`, `ElectionPicker.tsx`
- Test: `web/src/configure/widgets/ChoiceField.test.tsx`, `web/src/configure/widgets/OptionPicker.test.tsx`, `CutBuilder.test.tsx` (create)

**Interfaces:**
- Produces: `OptionPicker({ options: OptionItem[]; value: string | string[]; multiple: boolean; onChange; groupBy?: (o: OptionItem) => string; badge?: (o: OptionItem) => string | null; searchAbove?: number })`. Radio for single, check box for multiple. Options with `disabled_reason` render greyed with the reason, `aria-disabled="true"`, and ignore click and Enter. A search box appears when `options.length > searchAbove` (default 8). `ChoiceField` groups scenario options by `kind` ("Party questions", "Opinion questions") and badges `recalled` ones "Recalled". `CutBuilder` groups field options by `scope` ("Respondent fields", "Seat fields") with badge "Seat", and tints a seat field that is first in a table with at least one more field, with a one-line note naming that field.

- [ ] **Step 1:** Tests: a disabled option is not selected by click or by Enter and shows its reason text; single mode selects exactly one; multiple mode toggles; search "gend" hides non-matching options; `ChoiceField` renders a "Recalled" badge on `vs_past`; `CutBuilder` shows the seat note for `["party_zone","gender"]` and not for `["gender","party_zone"]` or `["party_zone"]`.
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Implement. Show the option `label` with the `value` (engine id) in small muted text beside it when they differ, so friendly names can arrive later without a change here. **Step 4:** Run; expect PASS. **Step 5:** Commit.

### Task 13: Every family panel renders

**Files:**
- Test: `web/src/configure/ConfigurePanel.test.tsx`

- [ ] **Step 1:** For each of the seven families in `configure_families.json`, render the panel and assert the primary fields appear in descriptor order, the "More options" count is 0 on an empty draft, and Apply is disabled until required fields are set. For `gender_differential`, assert there is no "Compare" choice. For `seat_ranking`, assert the Party field appears only after a party-type metric is chosen.
- [ ] **Step 2:** Run. If a case fails, fix the panel (not the test). **Step 3:** Commit.

### Task 14: End to end, docs, and visual check

**Files:**
- Modify: `web/e2e/cards.spec.ts`, `web/e2e/configure.spec.ts`, `web/e2e/cohorts.spec.ts`, `docs/testing.md` (if present), `docs/open-items.md`
- Modify: `docs/specs/2026-11-20-card-visual-design.md` (status line: built)

- [ ] **Step 1:** Update the Playwright specs for the new controls (lens chip at narrow width, View menu, seat selector, benchmark tabs, Make cohort steps). Add one test that resizes a card container and asserts the table's computed font size is 10.5px at 300px wide and 13px at 880px or more.
- [ ] **Step 2:** Run `npm run build`, `npm test`, `npm run typecheck`, `npm run e2e`, and `uv run pytest tests`. Expected: all pass. State anything not run.
- [ ] **Step 3:** Take Playwright screenshots of each card at 880, 560 and 340px and compare them by eye with the mock-ups; list differences in the spec.
- [ ] **Step 4:** Update `docs/open-items.md` (friendly question labels need a backend label source; dark mode; Configure at phone width) and commit.

## Not in this plan

- A friendly-name source for questions (backend): the pickers show the id beside the label so it can arrive later.
- Dark mode, and Configure at phone width.
- Canvas and tabs (sub-project 6b) and the context step and saving (6c).
