# Phase 1b — Dashboard Frontend (Shell, Context Bar, Composite Cells, State Pulse) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A React/TypeScript web app in `web/` that lets a user pick a state, level and rounds in a URL-backed context bar and see the four State Pulse cards (party scoreboard, leader satisfaction, appetite for change, support by zone) rendered as composite-cell tables from the Phase 1a API.

**Architecture:** A thin client over the Phase 1a FastAPI service. A typed API client + TanStack Query hooks (plan → run → poll) feed pure adapters that turn each card result (`scoreboard` / `opinion` / `grid`) into one `CellGrid` model; one `CompositeTable` (TanStack Table) renders any `CellGrid` with Show presets, density, transpose, sort and conditional formatting. The global context lives in the URL search params. The frontend never computes survey numbers: it formats, labels and lays out engine values in the order the API sends them.

**Tech Stack:** Node 20 / npm 10; React 18.3, TypeScript 5.6 (strict), Vite 5, Mantine 7 (`@mantine/core`, `@mantine/hooks`; spec §14 left Mantine vs shadcn/ui to visual design — Mantine chosen for built-in drawers, popovers and segmented controls without a Tailwind toolchain), TanStack Query 5, TanStack Table 8, React Router 6, Vitest 2 + Testing Library + jsdom, Playwright 1.49 (one journey). ECharts is **not** added in 1b: State Pulse cards default to tables and the sparkline is inline SVG; ECharts arrives with the first chart card (Phase 2).

**Spec:** `docs/specs/2026-11-08-dashboard-design.md` (§1, §4, §5, §6, §7.1, §8, §9, §14, §16, §17). Backend contract: `matbodh_dashboard/api/app.py`, `api/schemas.py`, `context.py`, `runner/service.py` (`_assemble`, `_rounds`, `_cell`), `normalise/cells.py`. Previous plan: `docs/plans/2026-11-09-phase-1a-backend.md`.

## Global Constraints

- **The engine owns every number.** No frontend code adds, subtracts, averages or rescales survey values. Δ is the cell's `delta` field only; a missing `delta` shows "—", never `value − trend[compare]`. No browser-side totals.
- **NULL is not zero.** `null` renders "—" with a reason (title/tooltip); never `0`, `0.0`, `NaN` or an empty cell.
- **Nothing is silently dropped.** Unavailable parts show their `reason`; `not_asked` rounds are named; `hidden_count > 0` shows "N values hidden"; unknown flags are shown; rows/columns keep API order (the API applied the presentation registry).
- **Round labels are never bare.** A short `label` (e.g. `R1`) appears only under its series group header; Δ titles, trend/pipe headers, tooltips and the context summary's Δ part use `base_name` (e.g. `Δ 2027 VS CAPI R2 − 2027 VS CAPI R1`). Round order is the API's order, never a sort by label.
- **Neutral across parties.** No party is highlighted or pre-selected; colours only from the API's `colour`. Focus party is not offered in 1b (no 1b card needs it) and is never defaulted.
- **Layout is display-only.** Transpose, Show preset, density, sort and formatting never trigger a request.
- **Context defaults:** nothing is auto-selected except a state when the catalogue has exactly one. With no rounds in the URL the context editor opens with "Choose a state, survey level and rounds to begin." and no card runs.
- `geo_scope` is always `"state"` (the backend rejects others); the summary shows `Geo: whole state`. `version_mode` is offered only for `ac`/`pc`; `zone`/`state` show "Normal only" and send `"extrapolated"` (the backend's only allowed value there).
- API base path in the browser: `/api` (Vite dev proxy → `http://127.0.0.1:8000`, prefix stripped). No CORS change to the backend.
- Every request sends header `X-Dashboard-User: anonymous` (principal hook, spec §18; no-op until phase 4).
- Poll `GET /runs/{id}` every 1500 ms while `state === "running"`; stop on `done | partial | failed`.
- No stack traces reach users; `errors[part].message` is already client-safe (config kind carries the engine message, other kinds are generic).
- Text: `▲`/`▼` for signed Δ, U+2212 `−` for negative values, `—` (em dash) for missing, `·` as separator.
- **Percentage formatting rule (decided 2026-11-09):** every percentage (units `pct` and `pp`, including Δ, net scores, gender gap, trend pipes, legends and tooltips) is shown with a `%` sign at the end. If the absolute value is **2 or more** it is rounded to a whole number (`41.5 → 42%`, `−2.68 → −3%`); if the absolute value is **below 2** it shows two decimals (`1.5 → 1.50%`, `0 → 0.00%`, `0.126 → 0.13%`). The threshold tests the unrounded absolute value (`1.996 → 2.00%`, `2.4 → 2%`). Seat counts (`seats`) are integers without `%`. Display only: CSV and tooltips-for-data keep full engine precision. One function (`formatPercent`) implements the rule; no other code formats percentages.
- TypeScript `strict: true`; no `any` in `src/` outside test files.
- Test commands: `cd web && npm test` (Vitest run mode); backend stays green with `.venv/Scripts/python.exe -m pytest -q`.
- API response fixtures are **generated by the backend** (Task 1) and committed; frontend tests never hand-write API JSON except small `Cell` literals and explicitly synthetic variants derived from a fixture.

## Review Focus

1. **A `null` value or `null` delta** (not-asked round, failed job, `no_delta`) — renders "—" with the flag's reason, never `0.0`/`NaN`. Tests: Task 4 `formatValue renders null as em dash`, Task 5 `not-asked cell shows dash with reason`.
2. **An engine Δ that differs from the difference of the displayed values** (fixture: NDA 40.0 → 38.0, engine Δ −1.5) — the cell shows `▼1.50%`, not `▼2%`. Test: Task 6 `scoreboard delta comes from the engine, not subtraction`.
6. **Values at the 2% boundary** (`1.996`, `2.0`, `-1.999`, `0`, `0.004`) — follow the percentage rule exactly: `1.996 → 2.00%`, `2.0 → 2%`, `-1.999 → −2.00%`, `0 → 0.00%`, `0.004 → 0.00%`. Test: Task 4 `percent rule boundary`.
3. **Context change while a run is in flight** — the old result is shown dimmed as "previous", never as the new context's result, and is replaced when the new run finishes. Test: Task 8 `result of an older context is marked stale`.
4. **Run handle lost** (`GET /runs/{id}` → 404 after an API restart or `MAX_RUNS` eviction) — the card restarts the run once, then shows an error; it never polls forever. Test: Task 8 `404 on poll restarts the run once`.
5. **Single-series selection where API labels are bare (`R1`, `R2`)** — Δ titles and trend headers use `base_name`. Test: Task 6 `delta header names both rounds in full`.

---

## File Structure

```
matbodh-dashboard/
  tests/api/fixture_export.py        # Task 1: generates web fixtures from the real API + fake engine
  tests/api/test_fixture_export.py   # Task 1: committed fixtures are current
  web/
    package.json, tsconfig.json, vite.config.ts, index.html, playwright.config.ts
    src/
      main.tsx, App.tsx              # Task 2 / Task 11: providers + router
      api/types.ts                   # Task 3: TS mirror of API shapes
      api/client.ts                  # Task 3: fetch wrapper, ApiError
      api/queries.ts                 # Task 8: TanStack Query hooks
      context/urlContext.ts          # Task 7: context <-> search params
      context/summary.ts             # Task 9: collapsed one-line summary
      context/ContextBar.tsx         # Task 9: summary + editor
      cells/format.ts                # Task 4: pure formatters
      cells/parts.ts                 # Task 5: presets/density -> parts, series breaks
      cells/CompositeCell.tsx        # Task 5
      cells/Sparkline.tsx            # Task 5
      table/grid.ts                  # Task 6: CellGrid, adapters, transpose, sort
      table/formatRules.ts           # Task 6: heat / diverging + legend
      table/csv.ts                   # Task 6: flattened CSV
      table/CompositeTable.tsx       # Task 6
      cards/coverage.ts              # Task 10: footer notes, flag legend
      cards/MethodDrawer.tsx         # Task 10
      cards/Card.tsx                 # Task 10
      shell/AppShell.tsx             # Task 11
      pages/StatePulse.tsx           # Task 11
      pages/ComingLater.tsx          # Task 11
      test/fixtures/*.json           # Task 1 output (generated, committed)
      test/setup.ts                  # Task 2
    e2e/state-pulse.spec.ts          # Task 12
```

## Shared Types (defined in Task 3, used everywhere)

```ts
export type Level = "ac" | "pc" | "zone" | "state";
export type Unit = "pct" | "pp" | "seats";
export type CellPart = "value" | "delta" | "trend" | "base" | "secondary" | "flags";
export type Density = "compact" | "standard" | "detailed";
export interface StateContext { state: string; level: Level; rounds: string[];
  compare_round: string | null; anchor_round: string | null;
  version_mode: "extrapolated" | "matched"; geo_scope: "state"; }
export interface Cell { value: number | null; delta: number | null; trend: (number | null)[];
  secondary: string | null; flags: string[]; base: number | null; }
export interface RoundItem { obs_id: string; label: string; base_name: string; cycle: string;
  series: string; round: number | null; dataset_id: string; version: "normal" | "extrapolated";
  fallback: boolean; seats: number; borrowed: number; seats_source: "metadata"; }
export interface RoundsBlock { items: RoundItem[];
  groups: { cycle: string; series: string; obs_ids: string[] }[];
  anchor: string; compare: string | null; }               // obs_ids
export interface PartReason { part: string; reason: string; }
export interface NotAsked { part: string; rounds: string[]; }   // base names
export interface SeriesLabel { series: string; label: string; colour: string | null; }
export interface ScoreboardRow extends SeriesLabel { flags: string[]; vote: Cell | null;
  seats_ac: Cell | null; seats_pc: Cell | null; gender_gap: Cell | null; }
export interface OpinionRow extends SeriesLabel { cell: Cell | null; }
export interface GridRow { value: string | null; label: string | null;
  series: (SeriesLabel & { cell: Cell | null })[]; }
export interface CardResult { card_id: string; operation: "scoreboard" | "opinion" | "distribution";
  state: string; rounds: RoundsBlock; unavailable: PartReason[]; not_asked: NotAsked[];
  coverage: { job: string; part: string; coverage: Record<string, unknown> }[];
  rules_version: string | number; engine_version: string; metadata_revision: number;
  alliance_epoch: number; hidden_count: number;
  scoreboard?: ScoreboardRow[]; opinion?: OpinionRow[]; not_returned?: string[];
  grid?: { row_dim: string; rows: GridRow[] }; }
export interface RunError { kind: string; message: string; fingerprint: string | null; jobs: string[]; }
export interface RunStatus { state: "running" | "done" | "partial" | "failed"; done: number;
  total: number; result: CardResult | null; errors: Record<string, RunError>; }
export interface PlanResponse { valid: true; errors: string[]; unavailable: PartReason[];
  not_asked: NotAsked[]; rounds: Omit<RoundItem, "cycle" | "series">[];
  coverage_mode: Record<string, string | null>; }
export interface SurveyVersion { seats: number; borrowed: number;
  start_date: string | null; end_date: string | null; }
export interface SurveyRound { base_name: string; label: string; round: number | null;
  versions: Partial<Record<"normal" | "extrapolated", SurveyVersion>>; }
export interface SurveyGroup { group: string; cycle: string; series: string; rounds: SurveyRound[]; }
export interface SurveysResponse { state: string; levels: Partial<Record<Level, SurveyGroup[]>>;
  skipped: { dataset_id: string; reason: string }[]; }
export interface Template { id: string; section: string; title: string;
  operation: "scoreboard" | "distribution" | "opinion"; questions: string[]; measures: string[];
  slices: string[]; cell: CellPart[]; density: Density;
  requires: { min_level: "state" | "ac"; focus_party: boolean }; }
```

Task 3 checks these against the generated fixtures. If a fixture disagrees, the backend wins: correct the type and record the change in the task report.

---

### Task 1: Backend-generated API fixtures for the frontend

**Files:**
- Create: `tests/api/fixture_export.py`, `tests/api/test_fixture_export.py`
- Create (generated): `web/src/test/fixtures/{states,surveys,templates_pulse,plan_scoreboard,plan_by_zone_state_level,run_scoreboard_done,run_scoreboard_partial,run_scoreboard_within_other,run_leaders_done,run_change_appetite_done,run_by_zone_done,run_running}.json`

**Interfaces:**
- Consumes: the `tests/api/test_app.py` construction (fakeredis `ResultCache`, `InlineQueue`, `FakeRunner`, `PRESET`, `RULES_YAML`, `TEMPLATES`, `make_query`); `ManualQueue` from `tests/runner/test_service.py` for `run_running`; `FakeRunner(failures={"seats_pc": [ValueError("pc boom")]})` for `run_scoreboard_partial`.
- Produces: `export(out_dir: Path) -> list[Path]` writing JSON (`indent=2, sort_keys=True, ensure_ascii=False`, trailing newline) from `TestClient` calls to the real endpoints; `main()` writes to `<repo>/web/src/test/fixtures`. Command: `.venv/Scripts/python.exe -m tests.api.fixture_export`.
- Contexts: AC context `{"state": "Uttar Pradesh", "level": "ac", "rounds": ["2027 VS CAPI R1", "2027 VS CAPI R2"], "compare_round": "2027 VS CAPI R1"}` for every run fixture; `plan_by_zone_state_level` uses `level: "state"` with a state-level round from the catalogue fixture (if `DATASET_ROWS` has none, the exporter adds one via `dataset_row` locally — shared fixtures stay unchanged).
- `run_scoreboard_within_other`: an exporter-local `FakeRunner` subclass adds party `JDL` (outside the keep list) to the ungrouped parties job with a share and makes it win 2 AC seats in `o1` and 0 in `o2`, so the backend itself assembles a row with flag `within_other`.

- [ ] **Step 1: Write the failing tests.** `test_frontend_fixtures_current(tmp_path)`: `export(tmp_path)`; each produced file's bytes equal the committed file (failure message: `run: python -m tests.api.fixture_export`). `test_fixture_set_covers_card_states`: every name above produced; `run_scoreboard_partial` has `state == "partial"` and `"seats_pc" in errors`; `run_running` has `state == "running"` and `result is None`; `plan_by_zone_state_level` has non-empty `unavailable`; `run_scoreboard_within_other.result.scoreboard` has a row with `"within_other" in flags`; `run_leaders_done` has a `not_asked` entry (catalogue fixture lacks `cm_satisfaction` in one round — if not, choose the round set that produces one and say so in the report).
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/api/test_fixture_export.py -v` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `export`/`main`, then run `main()` to write the fixtures.
- [ ] **Step 4: Run** the test file — Expected: PASS; then `.venv/Scripts/python.exe -m pytest -q` — Expected: all pass.
- [ ] **Step 5: Commit** `git add tests/api/fixture_export.py tests/api/test_fixture_export.py web/src/test/fixtures && git commit -m "test: export API fixtures for the frontend"`

### Task 2: Web scaffold

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/test/setup.ts`, `web/src/App.test.tsx`
- Modify: `.gitignore` (add `web/node_modules/`, `web/dist/`, `web/test-results/`, `web/playwright-report/`), `README.md` (new "Frontend" section: `cd web && npm install`, `npm run dev` with the API on `127.0.0.1:8000`, `npm test`, `npm run build`)

**Interfaces:**
- Produces: npm scripts `dev`, `build` (`tsc -b && vite build`), `preview`, `test` (`vitest run`), `typecheck` (`tsc --noEmit`), `e2e` (`playwright test`). `vite.config.ts`: proxy `"/api": { target: "http://127.0.0.1:8000", rewrite: p => p.replace(/^\/api/, "") }`; Vitest `environment: "jsdom"`, `setupFiles: ["src/test/setup.ts"]` (imports `@testing-library/jest-dom/vitest`; stubs `window.matchMedia` and `ResizeObserver` for Mantine); `resolveJsonModule` on. `App.tsx` exports `createQueryClient(): QueryClient` and `App` = `MantineProvider` + `QueryClientProvider` + `BrowserRouter`; tests wrap components with a `renderWithProviders(ui, { route })` helper in `src/test/render.tsx` (`MemoryRouter`, query client with `retry: false`).

- [ ] **Step 1: Write the failing test** `App.test.tsx`: `renders the product name` — `screen.getByText("MatBodh Dashboard")`.
- [ ] **Step 2: Run** `cd web && npm install && npm test` — Expected: FAIL (App missing).
- [ ] **Step 3: Implement** the scaffold (`@mantine/core/styles.css` imported in `main.tsx`).
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `git add .gitignore README.md web && git commit -m "chore: scaffold web frontend"`

### Task 3: API types and client

**Files:**
- Create: `web/src/api/types.ts`, `web/src/api/client.ts`, `web/src/api/client.test.ts`, `web/src/api/types.test.ts`

**Interfaces:**
- Produces: all **Shared Types**; `class ApiError extends Error { status: number; errors: string[] }`; `apiGet<T>(path: string): Promise<T>`; `apiPost<T>(path: string, body: unknown): Promise<T>`; `planCard(cardId: string, ctx: StateContext): Promise<PlanResponse>`; `startRun(cardId: string, ctx: StateContext): Promise<string>`; `getRun(runId: string): Promise<RunStatus>`. Base `/api`; header `X-Dashboard-User: anonymous`; JSON bodies `{card_id, context}`.

- [ ] **Step 1: Write the failing tests.** `types.test.ts`: each fixture assigned with `satisfies` (`runDone.json satisfies RunStatus`, `surveys.json satisfies SurveysResponse`, `templates_pulse.json satisfies Template[]`, `plan_scoreboard.json satisfies PlanResponse`, …) — checked by `npm run typecheck`. `client.test.ts` (`vi.stubGlobal("fetch", …)`): `422 becomes ApiError with errors` (`{"valid": false, "errors": ["at least one round must be selected"]}` → `status 422`, same `errors`); `404 detail becomes message` (`{"detail": "unknown run 'x'"}` → `errors == ["unknown run 'x'"]`); `network failure becomes ApiError status 0` with message `Cannot reach the dashboard API`; `sends principal header` (`X-Dashboard-User: anonymous`, URL `/api/cards/run`).
- [ ] **Step 2: Run** `npm test -- src/api && npm run typecheck` — Expected: FAIL.
- [ ] **Step 3: Implement.** Non-2xx: parse JSON if possible; `errors` = `body.errors` if an array, else `[body.detail]` if a string, else `[]`; `message` = first error or `HTTP {status}`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(web): typed API client"`

### Task 4: Cell formatters

**Files:**
- Create: `web/src/cells/format.ts`, `web/src/cells/format.test.ts`

**Interfaces:**
- Produces:
  - `formatPercent(v: number): string` — the percentage rule (Global Constraints): `|v| ≥ 2` → `Math.round(|v|)` digits, else `|v|.toFixed(2)`; sign `−` (U+2212) when `v < 0` and the displayed digits are not all zero; `%` suffix. Examples: `41.5 → "42%"`, `-2.68 → "−3%"`, `1.5 → "1.50%"`, `0 → "0.00%"`, `-0.004 → "0.00%"`.
  - `formatValue(v: number | null, unit: Unit): string` — `pct` → `formatPercent`; `pp` → `formatPercent` with an explicit `+` for positive values (`+5%`, `+1.50%`, `−3%`, `0.00%`); `seats` integer (`154`); `null` → `—`.
  - `formatDelta(d: number | null, unit: Unit): string` — `pct`/`pp`: `▲`/`▼` + `formatPercent(|d|)`; `seats`: `▲`/`▼` + integer. A delta that displays as zero has no arrow (`-0.004` → `0.00%`, `0` seats → `0`); `null` → `—`.
  - `formatTrendPipes(trend: (number | null)[], unit: Unit): string` — `33% | 42%` via `formatValue`; null entries `—`.
  - `flagInfo(flag: string): { glyph: string; reason: string }` from `FLAG_INFO`: `not_asked {"—","Not asked in this round"}`, `failed {"—","Calculation failed for this round"}`, `not_contender {"—","Not a seat contender"}`, `no_delta {"","No Δ available for this round pair"}`, `null_value {"—","No value returned"}`, `within_other {"⊂","Already counted inside Other"}`, `vote_from_seat_view {"†","Vote share from the seat view"}`, `borrowed {"*","Includes seats carried from an earlier round"}`, `low_base {"◌","Low base"}`; unknown flag → `{"?", <flag>}`.
  - `nullReason(cell: Cell): string` — reason of the first present flag among `failed, not_asked, not_contender, null_value`; else `No value returned`.

- [ ] **Step 1: Write the failing tests:** `formatValue renders null as em dash`; `percent rule boundary` (`1.996 → "2.00%"`, `2.0 → "2%"`, `-1.999 → "−2.00%"`, `1.99 → "1.99%"`, `0 → "0.00%"`, `0.004 → "0.00%"`, `-0.004 → "0.00%"`, `2.4 → "2%"`, `41.5 → "42%"`, `12.124964018941728 → "12%"`); `pp is signed with unicode minus` (`-2.68,"pp" → "−3%"`, `4.6,"pp" → "+5%"`, `1.5,"pp" → "+1.50%"`); `seats integer without percent` (`154 → "154"`); `delta arrows` (`-2.68,"pct" → "▼3%"`, `-1.5,"pct" → "▼1.50%"`, `91,"seats" → "▲91"`, `-0.004,"pp" → "0.00%"`, `0,"seats" → "0"`, `null → "—"`); `trend pipes keep nulls` (`[null, 41.5] → "— | 42%"`); `unknown flag is kept` (`flagInfo("weird")` → `{glyph:"?", reason:"weird"}`); `nullReason prefers failed`.
- [ ] **Step 2: Run** `npm test -- src/cells/format` — Expected: FAIL.
- [ ] **Step 3: Implement** (display only: `Math.abs` and `toFixed`, no other arithmetic).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(web): composite cell formatters"`

### Task 5: CompositeCell, parts and Sparkline

**Files:**
- Create: `web/src/cells/parts.ts`, `web/src/cells/CompositeCell.tsx`, `web/src/cells/Sparkline.tsx`, tests `parts.test.ts`, `CompositeCell.test.tsx`

**Interfaces:**
- Consumes: Task 4; `Cell`, `Unit`, `CellPart`, `Density`, `RoundsBlock`.
- Produces:
  - `type ShowPreset = "share" | "delta" | "both" | "both_trend"`; `defaultPreset(template: Template): ShowPreset` (`both_trend` if `trend ∈ template.cell`, else `both`).
  - `partsFor(preset: ShowPreset, density: Density, allowed: CellPart[]): CellPart[]` — preset base: `share [value]`, `delta [delta]`, `both [value, delta]`, `both_trend [value, delta, trend]`; `compact` removes `trend`; `detailed` adds `base, secondary, flags`; intersect with `allowed ∪ {base, secondary, flags}`; order `value, delta, trend, base, secondary, flags`.
  - `seriesBreaks(rounds: RoundsBlock): number[]` — trend indices where the series group changes.
  - `deltaTitle(rounds: RoundsBlock): string | null` — `Δ {anchor base_name} − {compare base_name}`; null without compare.
  - `<CompositeCell cell: Cell | null; unit: Unit; parts: CellPart[]; rounds: RoundsBlock />` — `null` cell → `—` titled "Not applicable"; null value → `—` titled `nullReason(cell)`; Δ part omitted when `rounds.compare` is null, titled `deltaTitle`; trend = pipes if `trend.length ≤ 4` else `<Sparkline>` (pipes titled with the `base_name`s joined ` | `); `base` shows `n {base}` only when `secondary` is null (seat cells already say `on N seats`); flags as glyph spans with `title` and `aria-label` = reason.
  - `<Sparkline values: (number | null)[]; breaks: number[] />` — inline SVG 64×16, scaled to the values' own min/max (display only); a null or a break index starts a new segment; `aria-label` `trend across {n} rounds`.

- [ ] **Step 1: Write the failing tests:** `partsFor maps presets and density` (`("both_trend","compact",[value,delta,trend]) → [value,delta]`; `("both_trend","detailed",[value,delta,trend]) → [value,delta,trend,base,secondary,flags]`; `("share","standard",[value]) → [value]`); `seriesBreaks finds group changes` (groups `[{obs_ids:["o1","o2"]},{obs_ids:["o3"]}]` → `[2]`); `not-asked cell shows dash with reason`; `delta title names both rounds in full` (rounds from `run_scoreboard_done.json` → `Δ 2027 VS CAPI R2 − 2027 VS CAPI R1`); `no compare round hides delta`; `five rounds render a sparkline, four render pipes`; `unknown flag rendered` (title `weird`).
- [ ] **Step 2: Run** `npm test -- src/cells` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(web): composite cell and sparkline"`

### Task 6: CellGrid, adapters, CompositeTable, formatting, CSV

**Files:**
- Create: `web/src/table/grid.ts`, `web/src/table/formatRules.ts`, `web/src/table/csv.ts`, `web/src/table/CompositeTable.tsx`, tests `grid.test.ts`, `formatRules.test.ts`, `csv.test.ts`, `CompositeTable.test.tsx`

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces:
  - `interface Header { key: string; label: string; colour: string | null; note?: string }`; `interface GridCell { cell: Cell | null; unit: Unit }`; `interface CellGrid { rows: Header[]; columns: Header[]; cells: Record<string, Record<string, GridCell>>; rowDim: string; columnDim: string }` (`cells[rowKey][colKey]`; a missing entry renders `—` "Not applicable").
  - `scoreboardGrid(result: CardResult): CellGrid` — rows = `scoreboard` in API order (`label`; flag `within_other` → `note: "within Other"`); columns in fixed order `vote` "Vote share" (pct), `seats_ac` "Seats AC" (seats), `seats_pc` "Seats PC" (seats), `gender_gap` "Gender gap" (pp, note `women − men`). A seat/gender column is included when any row has a non-null cell for it **or** `result.unavailable` names the part (header `note` = the reason; cells `—`).
  - `opinionGrid(result): CellGrid` — rows = `opinion` in API order (`label`), one column `net_score` "Net score" (pp); each `not_returned` question → a row of `—` with `note: "No result returned"`; each `unavailable` part → a row with the reason as `note`.
  - `zoneGrid(result): CellGrid` — rows = `grid.rows` (`label ?? "(no value)"`, key `value ?? "__null__"`), columns = series in first-seen order across rows (pct).
  - `gridFor(result: CardResult): CellGrid`; `transpose(g: CellGrid): CellGrid`.
  - `sortRows(g: CellGrid, by: { column: string; part: "value" | "delta"; dir: "asc" | "desc" } | null, apiOrder: string[]): CellGrid` — nulls last in both directions; stable; `null` restores `apiOrder`. Reorders only.
  - `type FormatRule = { kind: "none" } | { kind: "heat"; within: "column" | "row" | "table" } | { kind: "diverging"; within: "column" | "row" | "table" }` (heat on value, diverging on Δ); `cellStyle(g: CellGrid, rowKey: string, colKey: string, rule: FormatRule): { background?: string }` — heat: min/max of non-null values in scope; diverging: symmetric around 0 with the max |Δ| in scope, blue `>0`, orange `<0` (colour-blind safe); nulls unstyled; display scaling only. `legend(g, rule): { label: string; min: string; max: string } | null` (texts via Task 4; label `Heat on value` / `Diverging on Δ`).
  - `toCsv(g: CellGrid, rounds: RoundsBlock): string` — header `row`, then per column: `{col}_{round}` for each round's trend entry (`round` = `base_name` with spaces → `_`), `delta_{col}_{anchor}_vs_{compare}` (omitted without compare), `base_{col}`, `flags_{col}` (`;`-joined); full engine precision (no rounding); `null` → empty; RFC 4180 quoting; `\r\n` line ends.
  - `<CompositeTable grid; parts; rounds; rule; sort; onSort />` on TanStack Table (`getCoreRowModel`; ordering from `sortRows`). Column headers show `label` and `note`; a caption line names the anchor round (`{anchor base_name}`, spec §7.1); clicking a column header cycles value sort desc → asc → none; the legend renders under the table when `rule.kind !== "none"`.

- [ ] **Step 1: Write the failing tests** (on generated fixtures):
  - `scoreboard delta comes from the engine, not subtraction` — `scoreboardGrid(run_scoreboard_done.result).cells.NDA.vote.cell.delta === -1.5`; the rendered NDA vote cell contains `▼1.50%` and not `▼2%`; and no vote-share value in the table has a one-decimal form: the NDA value cell reads `42%` (fixture value 42.07), never `42.1`.
  - `seat winner outside keep list is its own row marked within Other` — `run_scoreboard_within_other`: row `JDL` exists with note `within Other`; its seats AC cell is its own (`trend[0] === 2`), and Other's seat cell is not that value.
  - `partial run keeps failed seat column with dashes` — `run_scoreboard_partial`: column `seats_pc` exists; NDA and SP+ cells carry `failed` and render `—`.
  - `unavailable seat parts appear as column notes` — a synthetic variant of `run_scoreboard_done.result` with `unavailable` = both seat parts with reason `Seat views need an AC or PC level survey` and seat cells `null` → both seat columns present with that note.
  - `opinion not-asked round is dash with reason` — the `run_leaders_done` row named in its `not_asked` shows `—` for that round's trend entry.
  - `delta header names both rounds in full` — rendered Δ titles contain `2027 VS CAPI R2 − 2027 VS CAPI R1`; no header text or title is exactly `R1` or `R2`.
  - `transpose twice is identity`; `sort by delta desc puts nulls last and null restores API order`; `diverging scale is symmetric` (Δ −2 and +4 in one column → −2 is orange at half the intensity of +4's blue); `heat ignores nulls`; `csv header flattens parts` (exact first line for `run_scoreboard_done`, starting `row,vote_2027_VS_CAPI_R1,vote_2027_VS_CAPI_R2,delta_vote_2027_VS_CAPI_R2_vs_2027_VS_CAPI_R1,base_vote,flags_vote`); `csv writes null as empty, not 0`; `csv keeps full precision`.
- [ ] **Step 2: Run** `npm test -- src/table` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- src/table && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(web): composite table, adapters, formatting and CSV"`

### Task 7: URL-backed context

**Files:**
- Create: `web/src/context/urlContext.ts`, `web/src/context/urlContext.test.ts`

**Interfaces:**
- Produces: `parseContext(params: URLSearchParams): StateContext | null` (null when `state`, `level` or any `rounds` is missing, or `level` invalid); `serialiseContext(ctx: StateContext, base?: URLSearchParams): URLSearchParams` (keys `state`, `level`, repeated `rounds` in order, `compare`, `anchor`, `version`; unrelated keys of `base` kept); `useDashboardContext(): { ctx: StateContext | null; setCtx(next: StateContext): void }` over React Router `useSearchParams` (push, so Back works). `geo_scope` always `"state"`; `version` other than `matched` → `extrapolated`.

- [ ] **Step 1: Write the failing tests:** `round-trips a full context` (rounds order kept, compare and anchor kept); `missing rounds gives null`; `invalid level gives null`; `unknown version falls back to extrapolated`; `unrelated params preserved`; `values with spaces and plus signs survive` (`"2027 VS CAPI REBEL R1"`, a state name containing `+`).
- [ ] **Step 2: Run** `npm test -- src/context/urlContext` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(web): URL-backed dashboard context"`

### Task 8: Query hooks — catalogue, templates, plan, run polling

**Files:**
- Create: `web/src/api/queries.ts`, `web/src/api/queries.test.tsx`

**Interfaces:**
- Consumes: Task 3 client; `StateContext`.
- Produces: `useStates()`, `useSurveys(state: string | null)` (staleTime 5 min), `useTemplates(section: string)` (staleTime Infinity); `useCardPlan(cardId: string, ctx: StateContext | null)` (key `["plan", cardId, ctx]`; disabled when ctx null); `useCardRun(cardId: string, ctx: StateContext | null, enabled: boolean): { status: RunStatus | null; current: CardResult | null; previous: CardResult | null; isStale: boolean; error: ApiError | null; refresh(): void }`.
  - On a `(cardId, ctx)` change: `startRun`, then poll `getRun` every 1500 ms until state ≠ `running`. `previous` = the last finished result of an earlier context, kept while the current context has none; `isStale` is true exactly then. A 404 from `getRun` restarts the run once per context; a second 404 sets `error`. `refresh()` restarts the run for the same context. Start errors (422/404/409) set `error` and stop.

- [ ] **Step 1: Write the failing tests** (fake timers; a `fetch` stub routing by URL to fixtures): `polls until done` (`run_running` then `run_scoreboard_done` → `status.state === "done"`; no further `GET /runs` after advancing 5 s); `result of an older context is marked stale`; `404 on poll restarts the run once` (second 404 → `error.status === 404`; exactly 2 `POST /cards/run`); `422 on start surfaces backend errors` (`error.errors[0] === "at least one round must be selected"`); `disabled when ctx is null` (no fetch).
- [ ] **Step 2: Run** `npm test -- src/api/queries` — Expected: FAIL.
- [ ] **Step 3: Implement** (run id kept per serialised context; polling via `useQuery` with `refetchInterval`).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(web): plan and run query hooks with polling"`

### Task 9: Context bar and editor

**Files:**
- Create: `web/src/context/summary.ts`, `web/src/context/ContextBar.tsx`, tests `summary.test.ts`, `ContextBar.test.tsx`

**Interfaces:**
- Consumes: `useStates`, `useSurveys`, `useDashboardContext`.
- Produces:
  - `contextSummary(ctx: StateContext, surveys: SurveysResponse): string` — `{state} · {LEVEL} level · {rounds part} · {Δ part} · {version part} · Geo: whole state`. Rounds part per series group with selected rounds, in API order: `{group} {first label}–{last label}` (single round: `{group} {label}`), groups joined ` + `. Δ part `Δ vs {compare base_name}` or `No Δ`. Version part `Extrapolated` / `Matched seats` (ac/pc) or `Normal only` (zone/state). The expected string in tests is built from the fixture's `group` value, e.g. `Uttar Pradesh · AC level · {group} R1–R2 · Δ vs 2027 VS CAPI R1 · Extrapolated · Geo: whole state`.
  - `<ContextBar />` — collapsed: summary + "Edit"; expanded panel: State `Select` (auto-chosen only when exactly one state), Level `SegmentedControl` limited to the state's `levels` keys, Rounds as checkbox groups per series group in API order (each shows `label`, version badges `Extrapolated`/`Normal`, seats, fieldwork `start_date – end_date` only when both present), Compare `Select` ("None" + selected rounds except the anchor), Anchor `Select` ("Latest (default)" + selected rounds), Version `SegmentedControl` (`Extrapolated` / `Matched seats`) for ac/pc, else text `Normal only`. Selecting rounds from more than one series shows `Different survey series`. Changing state or level clears rounds, compare and anchor. "Apply" calls `setCtx`; nothing runs before Apply. Plan 422 errors for the lead card are shown in the panel verbatim.

- [ ] **Step 1: Write the failing tests:** `summary names compare round in full`; `summary for state level says Normal only`; `empty URL opens editor with prompt` (`Choose a state, survey level and rounds to begin.`; no `POST /cards/run`); `level options come from the catalogue`; `changing level clears rounds`; `compare cannot be the anchor`; `mixed series is labelled`; `apply writes the URL` (assert with `parseContext(location.search)`).
- [ ] **Step 2: Run** `npm test -- src/context` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(web): context bar and editor"`

### Task 10: Card

**Files:**
- Create: `web/src/cards/coverage.ts`, `web/src/cards/MethodDrawer.tsx`, `web/src/cards/Card.tsx`, tests `coverage.test.ts`, `Card.test.tsx`

**Interfaces:**
- Consumes: `useCardPlan`, `useCardRun`, `gridFor`, `sortRows`, `CompositeTable`, `partsFor`, `defaultPreset`, `toCsv`, `legend`.
- Produces:
  - `PART_LABELS`: `vote` "Vote share", `gender_gap` "Gender gap", `seats_ac` "Seats AC", `seats_pc` "Seats PC", `parties` "Party list", `zone` "Zones"; other parts (opinion questions) use the result row `label` if present, else the raw id.
  - `coverageNote(rounds: RoundsBlock): string` — per item `{base_name}: {seats} seats · {Extrapolated | Normal}` + ` (no Extrapolated version)` when `fallback`, joined ` · `.
  - `excludedNote(result: CardResult): string | null` — for each `coverage[].coverage.excluded_by_observation` (`{key: seat[]}`), non-empty lists → `{n} seats excluded in {base_name}` (key matched to `obs_id` or `base_name`; unknown keys shown raw), de-duplicated across jobs, joined ` · `.
  - `notAskedNote(result: CardResult): string | null` — `{part label} not asked in {base names joined ", "}` per entry, joined ` · `.
  - `flagLegend(g: CellGrid): { glyph: string; reason: string }[]` — flags present in the grid only, `FLAG_INFO` order, unknown flags last.
  - `isSeatCard(t: Template): boolean` — scoreboard, or a slice in `party_zone, zone, district, pc_num, ac_num`.
  - `<Card template: Template; ctx: StateContext | null />`, states in order:
    1. ctx null → renders nothing.
    2. plan pending → skeleton.
    3. every card part unavailable (plan `unavailable` covers all parts; for opinion every question) → greyed card listing each reason; no run started.
    4. running → skeleton `{done} of {total} runs done`; with `previous`, the previous table dimmed (`opacity: 0.5`, `aria-busy="true"`) under the label `Showing previous selection`.
    5. `failed` → per error: `config` → its `message`; `too_heavy` → `This cut is too heavy` + message; `infrastructure` → `Temporary engine problem — try Refresh`; other kinds → message.
    6. `done` / `partial` → table; `partial` adds a banner `Some parts failed: {part labels}`.
  - Header: title; badge `{n} rounds` whose hover lists each `rounds.items` entry (`base_name`, version, fallback, seats, `dataset_id`). Toolbar: Show (`Share` / `Δ only` / `Both` / `Both + trend`), Density (`Compact` / `Standard` / `Detailed`; default `template.density`), `⇄ Transpose`, `Format` (None / Heat on value / Diverging on Δ; within column/row/table), Sort by Δ menu (value sort via header click), `⋯` menu: `How this was calculated`, `Export CSV` (downloads `{card_id}.csv`), `Refresh`. Footer: coverage note (seat cards only), excluded note, not-asked note, `{n} values hidden` (when > 0), flag legend, `Method: rules {rules_version} · engine {engine_version} · metadata r{metadata_revision} · alliances e{alliance_epoch}`.
  - `<MethodDrawer result: CardResult | null; plan: PlanResponse | null; errors: Record<string, RunError> />` — read-only: rounds with dataset ids and versions, plan `coverage_mode` per part, pretty `coverage` contract JSON, error kinds and fingerprints.

- [ ] **Step 1: Write the failing tests:** `coverageNote marks Normal fallback`; `excludedNote names rounds` (synthetic `{excluded_by_observation: {o1: [5, 9]}}` → `2 seats excluded in 2027 VS CAPI R1`); `card shows progress while running` (`run_running` → `{done} of {total} runs done` with that fixture's numbers); `fully unavailable card is greyed and never runs` (`plan_by_zone_state_level`); `partial card lists failed part` (`Some parts failed: Seats PC`); `infrastructure error message has no trace`; `transpose and preset do not refetch` (fetch count unchanged after Transpose and `Δ only`); `hidden values are announced` (synthetic `hidden_count: 2` → `2 values hidden`); `footer shows method versions`; `previous result shown dimmed while new context runs`.
- [ ] **Step 2: Run** `npm test -- src/cards` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(web): card with states, toolbar, footer and method drawer"`

### Task 11: Shell, routing and State Pulse page

**Files:**
- Create: `web/src/shell/AppShell.tsx`, `web/src/pages/StatePulse.tsx`, `web/src/pages/ComingLater.tsx`, `web/src/pages/StatePulse.test.tsx`
- Modify: `web/src/App.tsx` (routes), `web/src/App.test.tsx`

**Interfaces:**
- Consumes: `ContextBar`, `Card`, `useTemplates`, `useDashboardContext`.
- Produces: routes `/` → `/pulse` (search kept), `/pulse`, `/battleground`, `/coalitions`, `/leadership`, `/movement`, `/my-cards`, `/builder`. Left nav (Mantine `AppShell`): State Pulse, Seat Battleground, Voter Coalitions, Leadership & Anti-incumbency, Vote Movement, My cards, + Add a cut; links keep the current search string. `ComingLater`: `{Section} arrives in phase 2` (My cards and + Add a cut: `phase 3`). `StatePulse`: templates of section `pulse` in API order; the first is the full-width lead, the rest in a grid (1 column below 1200 px, 2 at 1200 px and above); with no ctx only the context prompt shows.

- [ ] **Step 1: Write the failing tests:** `pulse renders four cards in template order` (`Party scoreboard`, `Leader satisfaction`, `Appetite for change`, `Support by zone`); `nav keeps context in links`; `other sections say when they arrive` (`/coalitions` → `Voter Coalitions arrives in phase 2`); `no context shows prompt and no runs`.
- [ ] **Step 2: Run** `npm test -- src/pages src/App` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(web): shell, routing and State Pulse page"`

### Task 12: Journey test and manual live check

**Files:**
- Create: `web/playwright.config.ts`, `web/e2e/state-pulse.spec.ts`
- Modify: `README.md` (Frontend: e2e command, one-time `npx playwright install chromium`, manual live checklist)

**Interfaces:**
- Consumes: built app via `webServer: { command: "npm run build && npm run preview -- --port 4173", port: 4173 }`; API mocked with `page.route("**/api/**")` from the Task 1 fixtures (`POST /cards/run` → `{"run_id": "<card_id>"}`; first poll `run_running`, then the card's done fixture).

- [ ] **Step 1: Write the journey** `context change runs State Pulse`: open `/`; prompt visible; choose level AC, tick both rounds, compare `2027 VS CAPI R1`, Apply; URL has both rounds; the scoreboard NDA vote cell shows `▼1.50%`; `Support by zone` renders a table; Transpose on the scoreboard sends no new `/api/cards/run`; browser Back shows the prompt again.
- [ ] **Step 2: Run** `cd web && npx playwright install chromium && npm run e2e` — Expected: PASS (fix selectors/wiring until it does; selectors by role/label, not CSS classes).
- [ ] **Step 3: Run** `npm test && npm run typecheck && npm run e2e`, and the backend suite `.venv/Scripts/python.exe -m pytest -q` — Expected: all PASS.
- [ ] **Step 4: Document the manual live check** in README (each run needs the owner's go-ahead; network/VPN up; first `bash -c 'cat < /dev/null > /dev/tcp/<host>/8123'`): Redis running; `uvicorn matbodh_dashboard.bootstrap:create_production_app --factory --port 8000`; one `rq worker engine --with-scheduler --worker-class rq.worker.SimpleWorker --url "$DASHBOARD_REDIS_URL"`; `cd web && npm run dev`; choose Uttar Pradesh · AC · 2027 VS CAPI R1 + R2 · compare R1. Expected scoreboard (Appendix A, shown with the percentage rule): NDA 42% ▼3% · AC 154 ▼89 · PC 26 ▼23; SP+ 44% ▲3% · AC 249 ▲91 · PC 54 ▲23; BSP 12%; JDL 0.13% ⊂ within Other, AC 0 ▼2.
- [ ] **Step 5: Commit** `git commit -m "test(web): State Pulse journey and live check instructions"`

---

## Out of scope for 1b (spec phases 2–4)

Focus-party selector and Shakti card; question selector and Compare-with (no 1b template offers them); drill-down menu; charts/ECharts; PNG/SVG export; analyst notes, view-data tab, My cards, builder; multi-state context (the API takes one `StateContext`); read-only preset view (no `/presets` endpoint yet — the method drawer shows versions instead); threshold, top-N and data-bar formatting rules; phone layout; series header rows over round columns (1b keeps rounds inside cells as trend; the "rounds as columns" layout comes with Phase 2 round tables).
