# Frame A Visual Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the State Pulse page look like Figma Frame A ("A · State Pulse · AC-level survey (default)", file `KAwwifuB30DnFUatxqYVN6`, node `2:2`, 1440 × 1939) without changing behaviour, numbers or data flow.

**Architecture:** Styling and layout only, plus two small structural changes the frame requires: Seats AC · PC becomes one composite column, and the context summary moves into a top bar. Design tokens live in one `web/src/theme.ts` (Mantine theme + CSS variables); components read tokens, never hard-code colours. Frame A is the visual target for **this page only**; frames B, D, E are out of scope.

**Tech Stack:** unchanged (React 18, Mantine 7, TanStack). No new dependencies. Font: `Inter` with fallback stack `Inter, "Segoe UI", system-ui, sans-serif` (Inter is not bundled; do not add a font package).

**Spec:** `docs/specs/2026-11-08-dashboard-design.md` §7.1, §8, §14. Prior plan: `docs/plans/2026-11-09-phase-1b-frontend.md` (its Global Constraints stay binding).

## Global Constraints

- All Phase 1b constraints stay: the engine owns every number; NULL is not zero; the percentage rule (`formatPercent`: whole number if |v| ≥ 2, two decimals if < 2, `%` suffix) **wins over the digits drawn in Frame A** (Frame A shows `41.5`, `▲1.4` as wireframe samples); round titles/CSV use `base_name`; layout controls never trigger requests; no `any` in src; no new dependencies; `npm test` exits 0 with no Errors line; UTF-8 files.
- **No wireframe notation in the UI:** orange numbered pins, "Sample values — not survey data", the "Notes" frame and annotation text are design annotations, never built.
- **No dead controls:** Frame A chips for Question / Rows / Columns, "+ Add state", Focus party chips, the Shakti card and "Cell shows" checkboxes belong to features outside Phase 1b — do not render them.
- **Tokens (exact, from Figma):**
  - Text `#1c1f24`; secondary text `#6b7380`; border `#dbdee3`; table header bg `#f4f4f6`; chip/button border `#d6d9de`; primary `#2663eb`; selected-chip/active-nav bg `#e5edff`; gain green `#0d804d`; loss red `#bf3333`; white `#ffffff`. Page background: a very light grey (use `#f6f7f9`; verify against the frame screenshot).
  - Font sizes (px): page title 22 bold; card title 17 bold; subtitle 12 regular `#6b7380`; table header label 12.5 semibold `#6b7380`; header sub-label 11 regular; row label 13 semibold; composite value 16 semibold; Δ 12 semibold; sub-line (trend/secondary) 11.5 regular `#6b7380`; chips 12 medium; buttons 13 (primary semibold white, default medium); nav item 13 medium (active semibold `#2663eb`); nav section label 11 semibold `#6b7380`; context pill text 13.
  - Radii: card 10, context pill 8, coverage strip 8, chip 14, button 6, nav item 6. Chip padding 5 × 10; button padding 8 × 14.
- **Layout (px, 1440 viewport):** top bar height 62 (white, bottom border `#dbdee3`, padding 12 × 24, gap 14); left nav width 220 (white, right border `#dbdee3`, padding 20 × 16, item height 36, gap 4); main content width 1220 with 28 side padding; vertical gap between blocks 18; card inner padding 17 (top) × 19 (sides); table row padding 10 × 6, cell padding 0 × 8; scoreboard column widths 150 / 240 / 240 / 220; row bottom border 1px `#dbdee3`.
- **Frame A node ids** (for `get_design_context`): top bar `2:3`, left nav `2:27`, page header `2:50`, coverage strip `2:72`, party scoreboard card `20:176` (header `20:177`, table `20:199`), leader card `3:188` (table `21:175`), appetite card `3:268` (table `21:222`), party-zone card `3:327` (table `21:256`). Workers may call `get_design_context` (pass `skillNames: "figma-design-to-code"`, `excludeScreenshot: true`) and `get_screenshot` for any node; fetch before guessing. Screenshot of the whole frame: node `2:2`.

## Review Focus

1. **Wireframe notation or dead controls rendered** (pins, "Sample values", Question/Rows/Columns chips, "+ Add state", focus chips). Test: Task 3 `no wireframe notation or dead controls`.
2. **Colour-only Δ**: gain/loss must also carry ▲/▼ (never colour alone); a zero or null Δ is neutral grey, never green or red. Test: Task 2 `delta tone follows the sign and keeps the arrow`.
3. **Seats merge hides a failure**: when one of seats_ac / seats_pc is failed or not available, the merged cell must still say so (`—` with its reason), never show a half cell as a full one. Test: Task 2 `merged seats cell reports a missing level`.
4. **Hard-coded colours outside the theme.** Test: Task 1 `no hex colours outside theme.ts`.
5. **Behaviour regressions** (context URL, navigation keeping the search string, no request on layout controls, e2e journey). Existing tests stay green; e2e updated only for changed labels.

---

## File Structure

```
web/src/theme.ts                    # Task 1: tokens, Mantine theme, CSS variables, deltaTone
web/src/shell/AppShell.tsx          # Task 1: top bar + left nav + page background
web/src/context/ContextBar.tsx      # Task 1: summary pill + Edit context in the top bar; editor panel drops below it
web/src/pages/StatePulse.tsx        # Task 1/3: page header, coverage strip, spacing, card order
web/src/pages/CoverageStrip.tsx     # Task 1
web/src/cells/CompositeCell.tsx     # Task 2: value left, Δ right (toned), sub-line
web/src/cells/SeatsCell.tsx         # Task 2: merged AC · PC cell
web/src/table/grid.ts, csv.ts       # Task 2: merged "seats" column (CSV still expands both levels)
web/src/table/CompositeTable.tsx    # Task 2: header/row styling
web/src/cards/Card.tsx, CardToolbar.tsx, CardFooter.tsx   # Task 3: card chrome, chips + popovers, footer
web/e2e/visual.spec.ts, mockApi.ts  # Task 4: screenshots of the mocked page
```

---

### Task 1: Theme tokens, shell, page header, coverage strip

**Files:** Create `web/src/theme.ts`, `web/src/pages/CoverageStrip.tsx`; modify `web/src/App.tsx` (pass the theme), `web/src/shell/AppShell.tsx`, `web/src/context/ContextBar.tsx`, `web/src/pages/StatePulse.tsx`; tests alongside.

**Interfaces:**
- Produces: `export const tokens` (all colours/sizes/radii from Global Constraints, `as const`); `export const theme` (Mantine theme: fontFamily, primary colour from `#2663eb`, default radius 6); CSS variables `--mb-text`, `--mb-muted`, `--mb-border`, `--mb-header-bg`, `--mb-primary`, `--mb-primary-soft`, `--mb-gain`, `--mb-loss`, `--mb-page` on `:root`; `export function deltaTone(delta: number | null): "gain" | "loss" | "neutral"` (positive → gain, negative → loss, 0 or null → neutral; a delta whose display is zero per `formatDelta` — `0.00%` or `0` — is neutral).
- `<CoverageStrip rounds; versionMode; level; onToggleMatched />`: bold "Coverage", then per round `{label}: {seats} seats · {Extrapolated | Normal}{ (no Extrapolated version) when fallback}` (12px `#6b7380`, API `label`, `title` = `base_name`), right-aligned note "Applies to seat cards only" (11px) and a chip "Matched seats only" (selected style when `version_mode === "matched"`) toggling `version_mode` via `setCtx`. Shown only for `ac`/`pc` levels. Data from `useCardPlan("pulse.party_scoreboard", ctx)` (cached by the lead card; no extra request).

- [ ] **Step 1: Write failing tests:** `delta tone` (theme.test.ts: `deltaTone(1.4)=gain`, `(-0.6)=loss`, `(0)=neutral`, `(null)=neutral`, a display-zero delta neutral); `top bar shows brand, context pill and Edit context` (text `MatBodh`, pill contains the summary text, a primary button `Edit context`, no `+ Add state`); `nav labels and active style` (State Pulse, Seat Battleground, Voter Coalitions, Leadership, Vote Movement, My cards, `+ Add a cut`; captions `SECTIONS` and `MINE`; active link has `aria-current="page"`; links keep the search string); `page header` (heading `State Pulse`, subtitle `Where does each party stand right now, and how has that moved across rounds?`); `coverage strip lists each round and toggles matched` (fixture `plan_scoreboard`: a line per round; clicking `Matched seats only` yields `version=matched` in the URL; hidden at level `state`); `no hex colours outside theme.ts` (a Vitest test reading every non-test `web/src/**/*.tsx|ts` file with `fs`, failing on `#[0-9a-fA-F]{3,8}` literals outside `theme.ts`, `Sparkline.tsx` and `formatRules.ts`).
- [ ] **Step 2: Run** `cd web && npm test` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** tokens/theme; top bar (white, 62px, `MatBodh` 17 bold, context pill `#f4f4f6` with border, radius 8, showing the existing `contextSummary` text split on ` · ` into muted separators and dark values — text content identical to `contextSummary`; primary `Edit context` button on the right); the editor panel opens as a white bordered panel under the top bar, controls unchanged; left nav (220px, `SECTIONS`/`MINE` captions, active `#e5edff`/`#2663eb`, `+ Add a cut` primary button pinned to the bottom); page header (title 22 bold + subtitle); page background; 18px rhythm; `CoverageStrip`. Nav label `Leadership` replaces `Leadership & Anti-incumbency` in the nav only: give NAV entries a separate `title` for page placeholders so `ComingLater` copy keeps the full section name; update the tests that asserted the long label.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build` — Expected: PASS, `npm test` exit code 0.
- [ ] **Step 5: Commit** `feat(web): Frame A shell, tokens, page header and coverage strip`.

### Task 2: Composite cell, seats merge and table styling

**Files:** Modify `web/src/cells/CompositeCell.tsx`, `web/src/table/grid.ts`, `web/src/table/csv.ts`, `web/src/table/CompositeTable.tsx`; create `web/src/cells/SeatsCell.tsx`; tests alongside (update existing assertions whose text layout changed; keep their intent).

**Interfaces:**
- Cell layout (Frame A node `20:215`): value (16 semibold `#1c1f24`) at the left, Δ (12 semibold, tone colour, with ▲/▼) pushed to the right edge of the same baseline-aligned row; below it the sub-line (11.5 `#6b7380`): trend pipes for share cells (via `formatValue`, the percentage rule applies to every pipe) or `secondary` text (`F 44.1 · M 39.5`, `58 sat · 34 dis`, `on N seats`). A null value shows `—` in `#6b7380` with the reason as the sub-line (FLAG_INFO reasons: `Not a seat contender`, `Not asked in this round`, `Calculation failed for this round`); titles (`title`) stay as today. Compact density hides the sub-line; Standard shows trend; Detailed also base/flags (semantics of `partsFor` unchanged).
- `<SeatsCell ac: Cell | null; pc: Cell | null; rounds: RoundsBlock; parts: CellPart[] />`: value `{ac} · {pc}` (`formatValue(.., "seats")`, `*` suffix when the AC cell has flag `borrowed`), Δ `▲12 · ▲3` (each part toned individually), sub-line per round `{API short label} {ac} · {pc}` joined by ` | ` (titles use `base_name`). A missing level (null cell / failed / not asked) shows `—` in its slot with the reason in its `title` and is never merged away; both missing → one `—` with the reason as sub-line.
- `scoreboardGrid`: replace columns `seats_ac`/`seats_pc` by ONE column `seats` (label `Seats  AC · PC`, sub-label `AC · PC · Δ seats`) whose `GridCell` gets an optional `pcCell` (AC cell in `cell`); the column exists when either level has a non-null cell or is named in `result.unavailable` (header `note` lists the reasons joined with `; `). `toCsv` expands the merged column back to separate `seats_ac_…` and `seats_pc_…` columns (no data lost).
- Table style (node `20:199`): header row bg `#f4f4f6`, bottom border, padding 10 × 6, label 12.5 semibold `#6b7380` over an 11px sub-label built from the real rounds (vote: `% · Δ pp · trend {labels joined " | "}`; gender gap: `F − M, pp · Δ · F / M shares`; seats: `AC · PC · Δ seats`); body rows with 1px bottom border, row label 13 semibold; fixed column widths 150/240/240/220 (other cards: first column 150–200, remaining columns share); header and cells left-aligned.

- [ ] **Step 1: Write failing tests:** `delta tone follows the sign and keeps the arrow` (CompositeCell: −0.6 → `▼` with the loss variable, +1.4 → `▲` gain, 0/`null` neutral with no arrow; the arrow is present whenever tone ≠ neutral); `cell lays out value left and delta right` (value and Δ share one row container, sub-line is the second row); `null cell shows the reason as its sub-line`; `merged seats cell` (fixture `run_scoreboard_done`: AC and PC values and Δs from the fixture joined by ` · `, tones per part, sub-line contains each round's API label); `merged seats cell reports a missing level` (PC failed → `—` in the PC slot with title `Calculation failed for this round`, AC value still shown; both null → one `—`); `scoreboard has one seats column` (grid.test: columns `vote, seats, gender_gap`; unavailable parts become header notes); `csv expands merged seats` (header has `seats_ac_` and `seats_pc_` columns carrying fixture values at full precision); `table header and row styling` (header token background, row borders, widths); existing Task 6/10 tests updated where text changed (list edits in the report).
- [ ] **Step 2: Run** `npm test` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** (values/formatters untouched).
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build` — Expected: PASS, exit code 0.
- [ ] **Step 5: Commit** `feat(web): Frame A composite cells, merged seats column and table styling`.

### Task 3: Card chrome, chips with popovers, footer, zone default format

**Files:** Modify `web/src/cards/Card.tsx`, `CardToolbar.tsx`, `CardFooter.tsx`, `web/src/pages/StatePulse.tsx`; tests alongside.

**Interfaces:**
- Card container: white, 1px `#dbdee3`, radius 10, padding 17 × 19. Header: title (17 bold) + subtitle (12 `#6b7380`): `{lead card only: "Lead card · "}anchor round {anchor base_name} · Δ vs {compare base_name} · trend {first label} → {last label}` (omit `Δ vs` without compare; omit the trend part for a single round); this replaces the old "Anchor round:" caption and the `{n} rounds` badge (badge hover content moves to the subtitle `title`).
- Toolbar chips (right of the title, wrapping to a second line): `Cell: {current preset label} ▾`, `Density: {Standard} ▾`, `Format ▾`, `⇄ Transpose`, `Sort ▾` (only when sorting is possible) and a `⋯` button. Each of Cell/Density/Format opens a Mantine `Popover` with the existing controls: Cell = Presets pill group (Share, Δ only, Both, Both + trend); Density = Compact / Standard / Detailed; Format = None / Heat on value / Diverging on Δ and scope (`Within column` default, `Within row`, `Within all columns`). Chip labels reflect state; logic unchanged (display-only, no requests). Chip style: white bg, 1px `#d6d9de`, radius 14, padding 5 × 10, 12 medium; selected (non-default value): `#e5edff` bg, 1px `#2663eb`, `#2663eb` semibold. Do NOT render Question/Rows/Columns chips.
- Footer: one muted paragraph (11–12px `#6b7380`) with today's content (coverage note for seat cards, excluded/not-asked notes, hidden count, flag legend, method line) plus a right-aligned `How this was calculated →` in `#2663eb` that opens the existing method drawer; the format-rule legend stays under the table.
- Default format: a card whose template has `slices` (the party-zone card) starts with `{ kind: "diverging", within: "column" }`; every other card starts with `none`; the user can change it.
- Page card order (Frame A): scoreboard (full width), then leader scorecard and appetite for change in a two-column grid at ≥ 1200 px (one column below), then the zone card full width. No Shakti card.

- [ ] **Step 1: Write failing tests:** `no wireframe notation or dead controls` (page text has none of `Sample values`, `Question:`, `Rows:`, `Columns:`, `+ Add state`, `Focus party`, `Shakti`; the toolbar has Cell/Density/Format/Transpose chips and `⋯`); `subtitle names anchor compare and trend range` (fixture `run_scoreboard_done`); `cell chip opens presets and changes the cell without a request` (fetch count unchanged after choosing `Δ only`); `format chip shows scope and defaults to column`; `zone card starts with diverging format` (legend visible, text `scaled within each column`); `footer has the method link` (opens the drawer); existing Card tests updated for moved controls (list edits in the report).
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build` — Expected: PASS, exit code 0.
- [ ] **Step 5: Commit** `feat(web): Frame A card chrome, chips with popovers and zone default format`.

### Task 4: Visual capture for comparison with Frame A

**Files:** Create `web/e2e/visual.spec.ts`, `web/e2e/mockApi.ts` (extract the route-mock helper from `state-pulse.spec.ts` and import it from both specs).

**Interfaces:** the visual spec sets viewport 1440 × 1000, loads `/pulse?<AC context: rounds R1,R2, compare R1>` against the mocked fixtures, waits for the four card tables, writes `web/test-results/pulse-1440.png` (full page) and `web/test-results/scoreboard-card.png` (lead card). No pixel assertions; asserts no horizontal overflow (`document.documentElement.scrollWidth <= window.innerWidth`).

- [ ] **Step 1: Write the spec and run** `cd web && npm run e2e` — Expected: both specs PASS and the PNGs exist.
- [ ] **Step 2:** the controller compares `pulse-1440.png` with Frame A and lists remaining gaps; fixes go to ONE fix dispatch.
- [ ] **Step 3: Commit** `test(web): visual capture of State Pulse for Frame A comparison`.

---

## Out of scope

Frames B, C, D, E; the focus-party selector and Shakti card; Question/Rows/Columns controls; multi-state ("+ Add state"); "Cell shows" per-part checkboxes; drill-down menu; bundling the Inter font file; phone layout.
