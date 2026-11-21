# Multi-question and multi-survey layouts (sub-project C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A distribution or opinion card can read several surveys of the context at once and lay questions, surveys and breakdowns out as rows, columns or filters by the spec's layout table.

**Architecture:** The engine already returns one value per (row, column, round, lens) and `payloadToGrid` already pivots a round axis for trends, so layout is a frontend pivot of engine values; the backend only gains a `surveys` list on the card (standalone mode reads those rounds instead of the anchor only) plus the validation rules (several-by-several = overall only, one measure). The browser never computes a number: a cell is copied from the payload or shown empty with the engine's reason.

**Tech Stack:** Python 3.11 / pydantic / pytest (`.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider`); React + TypeScript + vitest (`cd web; npm test`, `npx tsc --noEmit -p .`); Playwright.

**Spec:** `docs/specs/2026-11-21-multi-survey-cards-design.md` (rules 3 and 4, layout table). Level rules (`card_blockers`) are built (sub-project B). Trend last-N/custom set and saved-card fingerprints are sub-project D, not here. Sparklines are out.

## Global Constraints

- Layouts apply to distribution and opinion families only (`MIXED_LEVEL_FAMILIES` minus gender differential and relationship, which keep their own layouts).
- Several questions x several surveys: overall only; the measure is derived, never chosen: all party questions show support share, all opinion questions show net score; a mix of party and opinion questions is blocked (owner to confirm); cuts disabled.
- Any cut with several questions or several surveys: the extra questions or surveys become one chosen filter (the table shows one at a time), never extra columns.
- With no seat-level cut the card applies no common-coverage intersection; each survey keeps its own coverage (zone/state rounds already force `independent`).
- No cap on the number of surveys (the 4-round cap belongs to trend's pipe view only); a value the engine did not return stays empty with its reason, never filled.
- `surveys` empty or only the anchor behaves exactly as today; existing tests keep passing.
- Commit explicit paths only; never touch `docs/specs/2026-11-08-dashboard-design.md`; commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- A selected survey that did not ask one of the card's questions: that survey's cells are empty with "not asked" (as trend's `not_asked`), the card still runs.
- `surveys` naming a round that is not in the context, or the anchor missing from it: card unavailable with the round named.
- Several-by-several with a cut, or with party and opinion questions mixed: rejected by the backend with the rule, not an engine error.
- Surveys of mixed levels with a seat-level cut (`ac_num`/`pc_num`): unavailable (rule from B), and coverage never `common` without a seat cut.
- All-party several-by-several shows support share and all-opinion shows net score, with no measure control anywhere.
- Switching the layout axis, the question filter or the survey filter never refetches (pure display state).

---

### Task 1: `surveys` on the card

**Files:**
- Modify: `matbodh_dashboard/cards/config.py` (`CardConfig`), `matbodh_dashboard/cards/compile.py` (`_select`, `read_levels`)
- Test: `tests/cards/test_config.py`, `tests/cards/test_compile.py`

**Interfaces:**
- Produces: `CardConfig.surveys: list[str] = []` (round base names chosen from the context; empty = anchor only). No `measure` field: the measure follows the questions' kind (`scenario_kind`).
- Rules in `_validate` (message prefix style of the existing `_fail`): `surveys` only for distribution/opinion in standalone mode; no duplicates; no length cap; when `len(surveys) > 1 and len(scenarios) > 1`: `cuts` must be `[[]]` and the scenarios must all be party or all be opinion.
- `_select` standalone mode: `used = [rounds named in config.surveys]` (anchor alone when empty); a survey missing from the context -> `unavailable` naming it; surveys lacking a scenario go to `not_asked` like trend. `read_levels` adds every `config.surveys` round, so `card_blockers` sees all their levels.

- [ ] **Step 1: Write failing tests**: `test_surveys_rejected_outside_standalone_distribution_opinion`, `test_several_by_several_rejects_cuts`, `test_several_by_several_rejects_mixed_party_and_opinion`, `test_single_survey_list_equals_anchor_only_request`, `test_survey_not_in_context_is_unavailable_naming_it`, `test_survey_without_the_scenario_is_not_asked_not_error`, `test_mixed_level_surveys_with_ac_num_cut_unavailable`, `test_no_common_coverage_without_a_seat_cut` (request `coverage_mode != "common"` for AC+AC surveys cut by `district`... assert the existing `choose_coverage` result and fix only if wrong).
- [ ] **Step 2: Run** `.venv\Scripts\python.exe -m pytest tests/cards/test_config.py tests/cards/test_compile.py -q`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the fields, validation and `_select`/`read_levels` change above.
- [ ] **Step 4: Run** the full suite. Expected: all pass (809+).
- [ ] **Step 5: Commit** `git add matbodh_dashboard/cards/config.py matbodh_dashboard/cards/compile.py tests/cards/test_config.py tests/cards/test_compile.py`; message `feat: grid cards read several surveys`.

### Task 2: Configure offers a survey picker

**Files:**
- Modify: `matbodh_dashboard/cards/configure/families.py` (descriptors), `matbodh_dashboard/cards/configure/options.py`, `web/src/api/types.ts` (draft type: `surveys?`), `web/src/configure/` (multi-select widget, summary text)
- Test: `tests/cards/test_configure_options.py`, `web/src/configure/summary.test.ts`, widget test beside the widget

**Interfaces:**
- Produces: field descriptor `surveys` (kind multi-select, options = every survey of the context, any number, shown only in standalone mode: this is where a card chooses its surveys, since the context bar only sets the pool, anchor and compare); the `cuts` descriptor is disabled with the reason "Cuts are not available with several surveys and several questions" in that state; `describeDraft` appends "across <surveys>".
- Consumes: `CardConfig.surveys` (Task 1).

- [ ] **Step 1: Write failing tests**: backend `test_surveys_options_are_the_context_rounds`; frontend `describeDraft` sentence with surveys, cuts control disabled when several-by-several.
- [ ] **Step 2: Run** `.venv\Scripts\python.exe -m pytest tests/cards/test_configure_options.py -q` and `cd web; npx vitest run src/configure`. Expected: FAIL.
- [ ] **Step 3: Implement** descriptors, options and widgets.
- [ ] **Step 4: Run** both suites and `npx tsc --noEmit -p .`. Expected: pass.
- [ ] **Step 5: Commit** explicit paths; message `feat: Configure picks surveys`.

### Task 3: The layout pivot

**Files:**
- Create: `web/src/cards/grid/layout.ts`
- Modify: `web/src/cards/grid/payloadToGrid.ts` (call `layoutGrid` when more than one survey or question is in the payload), `web/src/cards/ControlStrip.tsx`, `web/src/cards/families/_grid/GridBody.tsx`
- Test: `web/src/cards/grid/layout.test.ts`, `web/src/cards/ControlStrip.test.tsx`, `web/src/cards/families/_grid/GridBody.test.tsx`

**Interfaces:**
- Produces: `interface LayoutView { rowsAre: "surveys" | "breakdown" | "questions"; question: string | null; survey: string | null }` and `layoutGrid(p: GridPayload, view: GridView & LayoutView): CellGrid` returning the table for the spec's layout table: (several questions, one survey, overall) columns = questions, rows = breakdown (+ net score as the lens already offers); (any cut with several questions) rows = cut values x breakdown, one question chosen by `view.question`; (one question, several surveys, overall) rows = surveys or breakdown with `rowsAre` swapping the axes; (any cut, several surveys) one survey chosen by `view.survey`; (several x several) rows = surveys, columns = questions, the measure derived from the question kind (support share for party questions, the net-score lens for opinion questions). Cell values are copied from `p.cuts[].cells` (`row`, `column`, `round`, `lens`), never computed; absent cells are `{ cell: null }` with the payload's status flags.
- ControlStrip gains: an axis swap (shown for one question x several surveys overall), a question selector and a survey selector (shown when the layout needs a filter); all are display state, no request is sent.

- [ ] **Step 1: Write failing tests** in `layout.test.ts` with a hand-built payload of 2 questions x 2 surveys x 3 breakdown values (distinct numbers per cell so a wrong pivot fails): `columns are questions for several questions overall`, `a cut makes the second question a chosen filter`, `surveys become rows and swap with the breakdown`, `a cut with several surveys shows only the chosen survey`, `several by several shows one measure per cell`, `a missing cell keeps the payload status`, plus a `GridBody` test that changing the question selector changes cells without a new request (assert the fetch mock call count).
- [ ] **Step 2: Run** `cd web; npx vitest run src/cards`. Expected: FAIL.
- [ ] **Step 3: Implement** `layoutGrid` (pure function over the payload) and the control wiring; `payloadToGrid` keeps its current output when the payload has one survey and one question.
- [ ] **Step 4: Run** `npx vitest run`, `npx tsc --noEmit -p .`. Expected: pass; the existing payloadToGrid and table tests are unchanged.
- [ ] **Step 5: Commit** explicit paths; message `feat: lay out several questions and surveys`.

### Task 4: Live check, end-to-end and docs

**Files:**
- Modify: `docs/open-items.md` (O-F10 row), `docs/testing.md` if it lists card rules; Playwright spec in `web/e2e/` following the existing card specs

- [ ] **Step 1: Live check, read-only, Uttar Pradesh**: a distribution card, `surveys` = `2027 VS CAPI R2` + `2029 LS NT CATI R1`, one party question overall; then two party questions x two surveys. Expected: per survey the per-round base equals the single-survey run's base; a cut with several surveys returns one survey's rows for the chosen filter. Report what was not run.
- [ ] **Step 2: Playwright**: build a several-surveys card in the browser, flip the axis, choose a question filter; expected no extra network request on a flip.
- [ ] **Step 3: Record** in `docs/open-items.md`: C built or not, the live result, what is unverified.
- [ ] **Step 4: Run** all suites (backend, vitest, tsc, Playwright). Expected: pass.
- [ ] **Step 5: Commit** explicit paths; message `docs: record multi-survey layouts`.

## Open questions for the owner (my calls, correctable)

- **Party and opinion questions mixed** in several-by-several: blocked, since support share and net score cannot share one table. Say if it should be allowed another way.
- **Respondent filters** (the existing `filters` list) stay allowed with several-by-several; only cuts are disabled.
- **Survey count:** no cap on the card; I will report if the engine rejects a large set.
