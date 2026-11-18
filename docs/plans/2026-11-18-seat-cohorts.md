# Seat cohorts (5b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a seat ranking or seat benchmark card produce a seat set (an AC or PC id list), keep it for the user's session as a cohort, and let every card run filtered by that list through the dashboard context. Nothing is stored on the server.

**Architecture:** A cohort is a plain value (level, seat ids, label, created_at) held in the browser session. `StateContext` gains an optional `cohort` that the browser sends with every request; the backend validates it and the card compilers add the seat restriction to every engine job. Creation re-runs the card's own ranking or benchmark request through an engine selection (new `selection` job config) plus a fixed overall vote-share downstream request, through the existing runner queue and cache.

**Tech Stack:** Python 3.11, FastAPI, pydantic, RQ queue + cache already in `runner/`, React + TypeScript + Vite + Mantine + TanStack Query, pytest, Vitest, Playwright.

**Spec:** `docs/specs/2026-11-18-seat-cohorts-design.md`. Ledger: `docs/open-items.md` (update it in the same commit as each task that closes or opens an item).

## Global Constraints

- The engine owns every number; Python and TypeScript copy and reshape only. A missing value is a dash with a reason, never 0.
- Engine `PopulationFilter` values must be nonempty strings: send seat ids as strings (`["12","57"]`), operator `in`.
- An empty selection is never saved and never means "all seats".
- Demographic ranking cards have no cohort action (the engine cannot supply a seat set from them).
- A cohort is session-only (owner, 2026-11-18): no server storage, no save, list, rename or delete, no database. The browser keeps it in session storage; it is never in the URL. The backend treats the sent list as untrusted data and validates it.
- A cohort holds only seat level, seat ids, a label and created_at: no engine contract, no `selection_rows` beyond ids, no ranking/benchmark tables.
- A card that cannot run under the cohort is `unavailable` with a reason; it is never run unfiltered.
- Party scenarios for the creation query are the anchor round dataset's `scenarios` whose catalogue domain is `party` (`scenario_kind(id) == "party"`); never an invented list.
- Live runs are read-only and need the owner's go-ahead each time; never print or commit credentials; the engine repo `MatBodh-Dash` is read-only for this plan except Task 9, which needs the owner's explicit OK.
- Commit explicit paths only. Never touch or commit `docs/specs/2026-11-08-dashboard-design.md`. Run the full suites before every commit: `.venv/Scripts/python.exe -m pytest -q` and `cd web && npx vitest run && npm run typecheck`.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- An empty list, duplicate ids, non-integer or non-positive ids, or an oversized list sent by a client: rejected or deduplicated at the boundary, never run (Task 1).
- Two different cohorts, or a cohort versus none, must never share a cached run (Task 3, test on fingerprints).
- A PC cohort on an AC-designed survey over two or more rounds fails in the engine today (O-C5): the card must say so as unavailable, not surface "KeyError" or a raw engine error (Task 3).
- A ranking whose level differs from the cohort level (AC ranking under a PC cohort) must be unavailable with a reason (Task 4).
- A creation run for a trend ranking card or compare-mode ranking must use the anchor round's job and keep the comparison (Task 5).

## File Structure

Create:
- `matbodh_dashboard/cohorts/__init__.py`, `models.py` (`CohortRef`, `MAX_COHORT_SEATS`)
- `matbodh_dashboard/cohorts/restrict.py` (turn a cohort into the engine restriction for each family)
- `matbodh_dashboard/cards/cohort/compile.py` (selection job), `.../translate.py` (preview payload)
- `tests/cohorts/` (model, restrict, compile, api tests)
- `web/src/cohorts/` (`useSessionCohort.ts`, `CohortAction.tsx`, `CohortPredicate.tsx`, `CohortPreview.tsx`, `cohortApi.ts`, `CohortTab.tsx`, tests)

Modify: `context.py`, `capability.py` (cohort gating), `compiler/plan.py` (`kind` literal adds `"selection"`), `compiler/requests.py`, `cards/compile.py`, `cards/ranking/compile.py`, `cards/benchmark/compile.py`, `cards/relationship/compile.py`, `cards/config.py` (all-party-scenarios flag), `runner/service.py`, `api/app.py`, `api/schemas.py`, `web/src/api/{types,client,queries}.ts`, `web/src/context/{ContextBar,summary}.ts*`, `web/src/cards/{ranking/RankingCard,benchmark/BenchmarkCard,MethodDrawer}.tsx`, `web/src/pages/CardsPage.tsx`, `README.md`, `docs/open-items.md`.

## Decision used by this plan

**Q-10 / D-C9 (owner, 2026-11-18): Option A.** Under a cohort, seat rankings and benchmarks rank and compare only the cohort's seats (engine `seat_ids`). `restrict.py` keeps this in one function.

---

### Task 1: Cohort value and its validation

**Files:**
- Create: `matbodh_dashboard/cohorts/__init__.py`, `models.py`
- Modify: `matbodh_dashboard/context.py`
- Test: `tests/cohorts/test_models.py`, `tests/test_context.py`

**Interfaces:**
- Produces (`models.py`): `MAX_COHORT_SEATS = 2000`; `class CohortRef(BaseModel)` (extra forbidden): `seat_level: Literal["ac","pc"]`, `seat_ids: list[int]` (validator: every id a positive int, deduplicated and sorted, 1 to `MAX_COHORT_SEATS` entries, otherwise `ValueError`), `label: str` (1 to 120 chars, stripped), `created_at: datetime`.
- Produces: `StateContext.cohort: CohortRef | None = None`. The API returns the validator's message as a 422 through the existing `_invalid` path in `api/app.py` (no new route code needed because `CardRequest.context` is a `StateContext`).

- [ ] **Step 1: Write failing tests:** `test_ids_are_sorted_and_deduplicated`, `test_empty_list_rejected`, `test_over_cap_rejected`, `test_non_positive_or_non_integer_ids_rejected` (0, -1, "12", 1.5, True), `test_label_required`, `test_context_accepts_a_cohort_and_forbids_extra_keys`, and in the API tests `test_plan_with_invalid_cohort_is_a_422_with_reason`.
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/cohorts tests/test_context.py -q`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the model and the context field.
- [ ] **Step 4: Run** the same command plus `tests/api -q`. Expected: PASS.
- [ ] **Step 5: Commit** `git add matbodh_dashboard/cohorts matbodh_dashboard/context.py tests && git commit -m "feat: session cohort value in the context"`.

### Task 2: Cohort in the card compile entry points

**Files:**
- Modify: `matbodh_dashboard/runner/service.py` (`plan`, `start`), `matbodh_dashboard/compiler/plan.py` (`EngineJob.kind` adds `"selection"`)
- Test: `tests/runner/test_cohort_context.py`

**Interfaces:**
- Consumes: Task 1 `StateContext.cohort`.
- Produces: `CardRunService.plan(...)` and `start(...)` read `ctx.cohort` and pass `cohort=ctx.cohort` to `compile_card` (parameter added in Task 3). No store, no lookup.

- [ ] **Step 1: Write failing test:** `test_plan_passes_the_context_cohort_to_the_compiler` (spy on `compile_card`).
- [ ] **Step 2: Run;** expected FAIL.
- [ ] **Step 3: Implement** the pass-through; widen the `EngineJob.kind` literal.
- [ ] **Step 4: Run** `pytest tests/runner -q`. Expected PASS.
- [ ] **Step 5: Commit** `feat: pass the context cohort to the compilers`.

### Task 3: Apply the cohort to grid and relationship cards

**Files:**
- Create: `matbodh_dashboard/cohorts/restrict.py`
- Modify: `matbodh_dashboard/compiler/requests.py`, `matbodh_dashboard/cards/compile.py` (`compile_card`), `matbodh_dashboard/cards/relationship/compile.py`, `matbodh_dashboard/capability.py`
- Test: `tests/cohorts/test_restrict.py`, `tests/cards/test_compile.py`, `tests/cards/test_relationship_compile.py`

**Interfaces:**
- Consumes: Task 1 `CohortRef`.
- Produces (`restrict.py`):
  - `def respondent_filter(cohort: CohortRef) -> dict`: `{"field": "ac_num" | "pc_num", "operator": "in", "values": [str(i) ...]}`
  - `def cohort_blockers(cohort: CohortRef, survey_level: str, round_count: int) -> list[str]`: reasons the cohort cannot apply: an AC cohort needs an AC-designed survey; a PC cohort needs a PC- or AC-designed survey, and on an AC-designed survey needs `round_count == 1` (until Task 9, reason text: "PC cohorts across several AC-designed rounds need the AC-to-PC membership; not available yet").
- `compile_card(config, ctx, catalogue, preset, *, reference=None, parties=None, elections=None, cohort: CohortRef | None = None)`; every non-seat card adds `respondent_filter(cohort)` to the request filters (appended to the card's own filters) and uses `coverage_mode="common"` when more than one observation is in the request.

- [ ] **Step 1: Write failing tests:** `test_filter_values_are_strings_and_pc_uses_pc_num`; `test_blockers_ac_cohort_on_pc_survey`; `test_blockers_pc_cohort_two_ac_rounds_gives_membership_reason`; in `test_compile.py`: `test_cohort_adds_filter_and_common_coverage_for_a_two_round_card` (assert filter present, `coverage_mode == "common"`, card's own filters preserved), `test_cohort_changes_the_fingerprint` (call `fingerprint` on the job configs with/without cohort and with a different cohort), `test_unavailable_reason_when_cohort_cannot_apply`; relationship: `test_relationship_cohort_filter_and_common_coverage`.
- [ ] **Step 2: Run** them; expected FAIL.
- [ ] **Step 3: Implement.** `build_request` already takes `filters`; add the cohort filter in each compiler (never mutate card config). Unavailable reasons go through the existing `unavailable` list as `(GRID, reason)`.
- [ ] **Step 4: Run** `pytest tests/cohorts tests/cards -q`. Expected PASS; also run the full suite.
- [ ] **Step 5: Commit** `feat: apply a cohort to grid and relationship cards`.

### Task 4: Apply the cohort to ranking and benchmark cards

**Files:**
- Modify: `matbodh_dashboard/cohorts/restrict.py`, `matbodh_dashboard/cards/ranking/compile.py` (`_ranking`, `compile_ranking_card`), `matbodh_dashboard/cards/benchmark/compile.py`
- Test: `tests/cohorts/test_restrict.py`, `tests/cards/test_ranking_compile.py`, `tests/cards/test_benchmark_compile.py`

**Interfaces:**
- Consumes: Task 3 `cohort_blockers`.
- Produces in `restrict.py`: `def seat_restriction(cohort: CohortRef) -> dict[str, list[int]]` returning `{"seat_ids": [...]}` (the Q-10 default; the only place to change to `{"display_seat_ids": [...]}`).
- Seat ranking jobs: merge `seat_restriction` into the ranking dict (ranking dict already has `seat_ids` and `display_seat_ids` keys). Benchmark: merge into the `benchmark` dict (`seat_ids`). Demographic ranking: add `respondent_filter(cohort)` to the request filters instead. A ranking/benchmark whose seat level differs from `cohort.seat_level` is unavailable: "This card ranks {X}s; the cohort holds {Y}s".

- [ ] **Step 1: Write failing tests:** `test_seat_ranking_under_cohort_sets_seat_ids`, `test_demographic_ranking_under_cohort_adds_respondent_filter`, `test_ranking_level_mismatch_is_unavailable_with_reason`, `test_benchmark_under_cohort_sets_seat_ids_and_keeps_constant_id_benchmark`, `test_cohort_ranking_fingerprint_differs_from_none`.
- [ ] **Step 2: Run;** expected FAIL.
- [ ] **Step 3: Implement** by calling `seat_restriction` from the two compilers; the benchmark `id` stays the constant `"benchmark"`.
- [ ] **Step 4: Run** `pytest tests/cards tests/cohorts -q` and the engine-loader tests (`tests/cards/test_benchmark_engine_loader.py`, and add one that passes a cohort-restricted ranking through `ranking_from_dict`; Expected: loads and resolves offline).
- [ ] **Step 5: Commit** `feat: apply a cohort to ranking and benchmark cards`.

### Task 5: Selection job (creation run)

**Files:**
- Create: `matbodh_dashboard/cards/cohort/__init__.py`, `compile.py`, `translate.py`
- Modify: `matbodh_dashboard/compiler/plan.py` (`EngineJob.kind` adds `"selection"`), `matbodh_dashboard/cards/config.py` (nothing for this task)
- Test: `tests/cards/test_cohort_compile.py`, `tests/cards/test_cohort_engine_loader.py`, `tests/cards/test_cohort_translate.py`

**Interfaces:**
- Consumes: `compile_card` results (the card's own ranking/benchmark job config), `scenario_kind`, `RoundDataset.scenarios`.
- Produces:
  - `class SelectionPredicate(BaseModel)`: ranking: `rank_max: int | None`, `metric_min: float | None`, `metric_max: float | None`, `lower_inclusive: bool = True`, `upper_inclusive: bool = False`; benchmark: `endpoint: Literal["target","reference"] | None`, `status: Literal["winning","losing"] | None`, `margin_min`, `margin_max`, `flip: Literal["gain","loss","winning_both","losing_both"] | None` plus the same two inclusivity flags. Validators: at least one predicate field; ranking and benchmark fields never mixed; `flip` requires a reference (checked at compile).
  - `def compile_cohort_selection(config: CardConfig, ctx: StateContext, catalogue: Catalogue, preset: MethodPreset, predicate: SelectionPredicate, *, reference=None, parties=None, elections=None) -> RunPlan`: compiles the card normally (no cohort), picks the card's anchor job (single job, or for a trend ranking the job whose `ranking.target[0]` is the anchor observation), and returns one `EngineJob("selection", "selection", GRID, config)` where `config = {sources, alliances, request: downstream, <ranking|benchmark>: card's own dict, selection: {"id": "cohort", **predicate, "source_request": card's request}}`. `downstream = build_request(...)` with only the anchor observation, `scenarios = sorted(s for s in anchor dataset scenarios if scenario_kind(s) == "party")`, `grouping_sets=[[]]`, no filters, comparisons or caste clubbing. Unavailable if no party scenario, the card is a demographic ranking, or `flip` without a reference.
  - `translate_selection(result: Mapping, ...) -> CohortPreview` with `seat_ids: list[int]`, `seat_level`, `count: int`, `table: <grid payload of the overall vote share>`; pulls ids only from the engine's `selection_rows`.

- [ ] **Step 1: Write failing tests:** `test_trend_ranking_uses_the_anchor_rounds_job`; `test_compare_ranking_keeps_its_comparison_in_source_request`; `test_downstream_is_overall_anchor_party_scenarios_only` (assert no filters/comparisons/caste, scenarios equal the party-domain subset of the anchor dataset, a scenario missing from the anchor dataset is absent); `test_demographic_ranking_has_no_selection`; `test_flip_without_reference_is_unavailable`; `test_rank_max_per_partition_is_passed_through`; engine-loader test: the config passes the engine's `selection_from_dict` plus `validate_selection` offline (as `tests/cards/test_benchmark_engine_loader.py` does for benchmarks); translate test with a recorded `SelectedAnalysisResult`-shaped dict (store the fixture under `tests/fixtures/engine_samples/` from `MatBodh-Dash/sample-output` aggregates only) asserting ids and count.
- [ ] **Step 2: Run;** expected FAIL.
- [ ] **Step 3: Implement.** Reuse `build_request` and `view_config`; do not alter the card's dicts; copy them.
- [ ] **Step 4: Run** `pytest tests/cards -q`. Expected PASS.
- [ ] **Step 5: Commit** `feat: cohort selection job and preview translation`.

### Task 6: Selection preview service and route

**Files:**
- Modify: `matbodh_dashboard/runner/service.py`, `matbodh_dashboard/api/app.py`, `matbodh_dashboard/api/schemas.py`
- Test: `tests/runner/test_selection_preview.py`, `tests/api/test_cohort_preview_api.py`

**Interfaces:**
- Consumes: Task 5.
- Produces: `CardRunService.start_selection(card_id: str, ctx: StateContext, predicate: SelectionPredicate, reference=None) -> str` (reuses `_advance`, cache, queue and error classification; when done, `status()` returns the `CohortPreview` payload through an assembly branch keyed on the plan job kind `"selection"`); route `POST /cohorts/preview` body `PreviewRequest{card_id, context, predicate, reference?}` -> `RunStarted`; context validation through `validate_context`; a demographic ranking card, an unknown card or an invalid predicate is a 422 with the reason. `GET /runs/{id}` is unchanged. Nothing is persisted anywhere.

- [ ] **Step 1: Write failing tests** with the existing fake queue/cache: `test_preview_run_returns_ids_count_and_table`, `test_preview_with_no_matching_seats_returns_count_zero_and_no_ids`, `test_demographic_card_preview_is_422_with_reason`, `test_preview_does_not_write_anything_beyond_the_run_cache`.
- [ ] **Step 2: Run;** expected FAIL.
- [ ] **Step 3: Implement** the service method and route.
- [ ] **Step 4: Run** the full backend suite. Expected PASS.
- [ ] **Step 5: Commit** `feat: cohort selection preview run`.

### Task 7: Dynamic party scenarios and the cohort's overall vote-share card

**Files:**
- Modify: `matbodh_dashboard/cards/config.py`, `matbodh_dashboard/cards/compile.py`, `config/cards/cards.yaml`
- Test: `tests/cards/test_config.py`, `tests/cards/test_compile.py`, `tests/cards/test_cards_yaml.py` (existing yaml test file; extend)

**Interfaces:**
- Produces: `CardConfig.all_party_scenarios: bool = False` (distribution family, standalone only, `cuts: [[]]`; `scenarios` must then be empty); `compile_card` expands it to the anchor dataset's party-domain scenarios (`scenario_kind == "party"`); new card `distribution.overall_vote_share` (`section: coalitions`, `all_party_scenarios: true`, `cuts: [[]]`, `requires: {min_level: state}`) used as the cohort tab's first table.

- [ ] **Step 1: Write failing tests:** `test_all_party_scenarios_requires_standalone_distribution_and_empty_scenarios`, `test_all_party_scenarios_expands_to_the_anchor_party_scenarios_only`, `test_overall_vote_share_card_loads_from_yaml`, and one `translate_grid` test that columns follow the engine result, not `config.scenarios` (check how `translate_grid` derives columns first; if it reads `config.scenarios`, change it to the plan's expanded scenarios).
- [ ] **Step 2: Run;** expected FAIL.
- [ ] **Step 3: Implement** the field and expansion; add the yaml card.
- [ ] **Step 4: Run** `pytest tests/cards -q`. Expected PASS.
- [ ] **Step 5: Commit** `feat: overall vote-share card over all party scenarios`.

### Task 8: Frontend (cohort action, preview, session cohort, cohort tab)

**Files:**
- Create: `web/src/cohorts/cohortApi.ts`, `useSessionCohort.ts`, `CohortAction.tsx`, `CohortPredicate.tsx`, `CohortPreview.tsx`, `CohortTab.tsx` and a `.test.tsx` for each
- Modify: `web/src/api/types.ts` (`StateContext.cohort?: CohortRef | null`, `SelectionPredicate`, `CohortPreview`), `web/src/api/client.ts`, `web/src/api/queries.ts`, `web/src/context/ContextBar.tsx` and `summary.ts` (label, seat count, Clear), `web/src/cards/ranking/RankingCard.tsx`, `web/src/cards/benchmark/BenchmarkCard.tsx`, `web/src/cards/MethodDrawer.tsx` (cohort line), `web/src/pages/CardsPage.tsx`
- Test: the new tests; `web/e2e/cohorts.spec.ts`

**Interfaces:**
- Consumes: Task 6 route. Produces: `startPreview(cardId, ctx, predicate, reference?) -> {run_id}`; `useSessionCohort(): { cohort: CohortRef | null; setCohort(c: CohortRef): void; clearCohort(): void }` backed by `sessionStorage` (wrapped in try/catch; works without it), keyed per state so a cohort never applies to another state; the dashboard context hook merges the session cohort into the `StateContext` sent to `planCard` and `startRun`; the URL is unchanged (no `cohort` parameter). "Make cohort" is rendered by `RankingCard` (only `seat_ranking` payloads) and `BenchmarkCard`, never for demographic ranking. `CohortPredicate` shows ranking fields (rank_max, metric bounds) or benchmark fields (margin range, status, flip class only when a reference is set, endpoint). `CohortPreview` shows the seat count, the overall vote-share table and a short seat list, "Use as cohort" (disabled at zero seats) and Cancel. The cohort tab is `CardsPage` with the session cohort applied and a single `distribution.overall_vote_share` card. UI layout and canvas behaviour are the owner's; build the minimum that is functional and accessible.

- [ ] **Step 1: Write failing tests:** the session cohort survives a remount and clears with `clearCohort`; sessionStorage throwing leaves an in-memory cohort working; a cohort for state A is not applied to state B; `CohortAction` not rendered for demographic ranking; flip option hidden without a reference; preview shows the count and "no seats matched" with Use disabled; Use sets the cohort and opens the cohort tab; the context sent to `planCard` includes the cohort; ContextBar shows label and count and Clear removes it.
- [ ] **Step 2: Run** `cd web && npx vitest run src/cohorts src/context`; expected FAIL.
- [ ] **Step 3: Implement** with existing components (`PopoverChip`, `CardShell`, Mantine form controls); no number is computed in the browser.
- [ ] **Step 4: Run** `npx vitest run && npm run typecheck && npm run build`, then `npm run e2e` with a new journey (stubbed API like the existing ones): make a cohort from a ranking card, use it, land on the cohort tab, see the overall table, reload, still applied, clear.
- [ ] **Step 5: Commit** `feat: cohort action, preview and session cohort`.

### Task 9: PC cohorts across AC-designed rounds (host layer, needs owner OK)

**Files:**
- Modify (repo `MatBodh-Dash`): `matbodh_views/named_runtime.py` (plain analysis path, last `access.execute` call) and its tests under `tests/`
- Then modify (dashboard): `matbodh_dashboard/cohorts/restrict.py` (`cohort_blockers` stops blocking the multi-round PC case)

**Interfaces:** the plain path supplies `access.seat_snapshot(request.state, "ac")` as the AC-keyed membership snapshot when the request has a `pc_num` filter or PC coverage over AC-designed observations, as the selection path does at `named_runtime.py:52`.

- [ ] **Step 1: Ask the owner** for permission to change `MatBodh-Dash`; stop here if not granted (v1 ships with the single-round limit, ledger O-C5 stays open).
- [ ] **Step 2: Write the failing engine-side test** (numerical fixture with two AC rounds and a `pc_num` filter distinguishing a wrong implementation: expected PC set equals PCs whose full AC membership is covered) following `MatBodh-Dash/CLAUDE.md` (run `python -m unittest discover -s tests -v`; database tests skipped are not passed).
- [ ] **Step 3: Implement** the snapshot supply; run the engine suite.
- [ ] **Step 4: Dashboard:** update `cohort_blockers` and its tests; live check with the owner's go-ahead (Task 10).
- [ ] **Step 5: Commit** in each repo separately with explicit paths.

### Task 10: Live verification, docs and ledger

**Files:** Modify `README.md` (cohort section: create, apply, limits, live results), `docs/open-items.md` (close O-C1, O-C4, O-C6 to O-C9 as built (O-C2, O-C3 are dropped); Q-10 answer; move rows to Closed), `scripts/smoke_card.py` (flag `--cohort-from <card id> --predicate '<json>'` to run preview then one card under the session list).

- [ ] **Step 1: Write the failing test** for the smoke argument parsing in `tests/test_smoke_script.py`.
- [ ] **Step 2: Implement** the flag; run `pytest tests/test_smoke_script.py -q`.
- [ ] **Step 3: With the owner's go-ahead and VPN,** run read-only on UP, R1 and R2: AC cohort "NDA winning in R2" from `ranking.ac_pm_net` style card (expect 154 AC as on 2026-11-12), then `distribution.support_by_caste` and `relationship.up_past_to_current` under it, and compare numbers with the engine CLI selection run (identical within float tolerance). PC single-round cohort. Record results in README.
- [ ] **Step 4: Run** all suites and `npm run e2e`.
- [ ] **Step 5: Update the ledger and commit** `docs: cohorts live results and ledger`.

## Self-review

- Spec coverage: sections 5.1 (Tasks 1, 8), 5.3 (Tasks 5, 6, 8), 5.4 (Tasks 2 to 4), 5.5 (Task 6), 5.6 (Task 3 reason, Task 9), 5.7 (a short seat list in the preview and context bar; seat names via the existing `SeatLabelProvider` need a read endpoint), 5.8 (Tasks 2, 6), section 6 verification (Tasks 3 to 10). Seat names: Task 8 must call the existing master label lookup through a read endpoint added in Task 6 if the popover needs names; if not trivial, ship ids only and log it as a ledger item.
- Names are consistent across tasks: `CohortRef`, `respondent_filter`, `seat_restriction`, `cohort_blockers`, `SelectionPredicate`, `compile_cohort_selection`, `start_selection`, `useSessionCohort`.
