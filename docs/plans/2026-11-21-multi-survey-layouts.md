# Multi-question and multi-survey layouts (sub-project C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any card can read its own survey instead of the context's anchor (and its own comparison survey), and a Party vote share or Opinion card can read several surveys at once, laid out by the spec's layout table.

**Architecture:** A card carries optional `anchor_round` and `compare_round` overrides of the context's; one function, `card_context`, applies them before any compile path runs, so every family reads the card's rounds with no change of its own. Several surveys are a `surveys` list on distribution and opinion cards. The engine already returns one value per (row, column, round, lens), so layout is a frontend pivot of engine values; the browser never computes a number: a cell is copied from the payload or shown empty with the engine's reason. The context bar's anchor and compare logic is unchanged and stays the default.

**Tech Stack:** Python 3.11 / pydantic / pytest (`.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider`); React + TypeScript + vitest (`cd web; npm test`, `npx tsc --noEmit -p .`); Playwright.

**Spec:** `docs/specs/2026-11-21-multi-survey-cards-design.md` (rules 3 and 4, layout table). Level rules (`card_blockers`) are built (sub-project B). Trend last-N/custom set and saved-card fingerprints are sub-project D, not here. Sparklines are out.

## Global Constraints

- Several surveys and the layouts apply to distribution and opinion families only; the card-level anchor and compare override applies to every family (`MIXED_LEVEL_FAMILIES` minus gender differential and relationship, which keep their own layouts).
- Several questions x several surveys: overall only; the measure is derived, never chosen: all party questions show support share, all opinion questions show net score (a card is party-only or opinion-only by its family, so the two never mix); cuts disabled.
- Any cut with several questions or several surveys: the extra questions or surveys become one chosen filter (the table shows one at a time), never extra columns.
- With no seat-level cut the card applies no common-coverage intersection; each survey keeps its own coverage (zone/state rounds already force `independent`).
- No cap on the number of surveys (the 4-round cap belongs to trend's pipe view only); a value the engine did not return stays empty with its reason, never filled.
- The context's anchor and compare logic is unchanged; a card with no override behaves exactly as today and existing tests keep passing. Configure holds no level rules: unavailable combinations come from the backend's validation and the existing "This card cannot run yet" alert.
- Commit explicit paths only; never touch `docs/specs/2026-11-08-dashboard-design.md`; commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- A selected survey that did not ask one of the card's questions: that survey's cells are empty with "not asked" (as trend's `not_asked`), the card still runs.
- An override naming a round that is not in the context (or has left it since the card was saved): card unavailable with the round named.
- Seat ranking, Group ranking or Seat benchmark pointed at a zone or state-wide round: unavailable with the existing level reason; Configure lists only AC and PC rounds for them.
- Several-by-several with a cut: rejected by the backend with the rule, not an engine error.
- Surveys of mixed levels with a seat-level cut (`ac_num`/`pc_num`): unavailable (rule from B), and coverage never `common` without a seat cut.
- A Party vote share card shows support share and an Opinion card shows net score in several-by-several, with no measure control anywhere.
- Switching the layout axis, the question filter or the survey filter never refetches (pure display state).

---

### Task 1: A card can override the anchor and compare rounds

**Files:**
- Modify: `matbodh_dashboard/cards/config.py` (`CardConfig`), the one place the service builds a plan or run from `(config, ctx)` (find it with `grep -n "def plan\|def run" matbodh_dashboard/runner/service.py`) plus `POST /cards/validate` and the options endpoint, so all of them read the same overridden context
- Create: `card_context(config: CardConfig, ctx: StateContext) -> StateContext` in `matbodh_dashboard/cards/context.py`
- Test: `tests/cards/test_card_context.py`, `tests/cards/test_compile.py`, `tests/cards/test_ranking_compile.py`, `tests/cards/test_benchmark_compile.py`

**Interfaces:**
- Produces: `CardConfig.anchor_round: str | None = None` and `CardConfig.compare_round: str | None = None` (round base names; empty = use the context's). `card_context` returns `ctx.model_copy(update=...)` with `anchor_round` and `compare_round` replaced when set; it raises a `ValueError` naming the round when a name is not in `ctx.rounds`. `compare_round` is rejected unless `comparison.mode == "compare"` or the family is a benchmark/ranking compare card; `anchor_round` is allowed in every mode. Everything downstream (`resolve_anchor`, `anchor_level`, `card_blockers`, `_endpoint_round`) is unchanged and sees the overridden context, so a card on a non-anchor AC or PC round works for every family, and a zone or state-wide round on a seat card is refused by the existing level guard.
- A saved card whose round has left the context is unavailable with the round named (the same message `_endpoint_round` already uses); removal on a changed context is sub-project D.

- [ ] **Step 1: Write failing tests**: `test_card_context_replaces_anchor_and_compare`, `test_card_context_without_overrides_is_identical`, `test_unknown_round_names_it`, `test_compare_round_rejected_in_standalone`, plus one compile test per family on a non-anchor AC round (`test_distribution_reads_the_card_round`, `test_seat_ranking_reads_the_card_round`, `test_seat_benchmark_reads_the_card_round`) asserting the compiled request's observation is the card round, and `test_seat_ranking_on_a_state_round_is_refused`.
- [ ] **Step 2: Run** `.venv\Scripts\python.exe -m pytest tests/cards -q`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the two fields, `card_context`, and call it where the service builds the plan, run and validation from `(config, ctx)`.
- [ ] **Step 4: Run** the full suite. Expected: all pass (809+).
- [ ] **Step 5: Commit** explicit paths; message `feat: a card can read its own anchor and compare round`.

### Task 2: Several surveys on a Party vote share or Opinion card

**Files:**
- Modify: `matbodh_dashboard/cards/config.py` (`CardConfig.surveys`), `matbodh_dashboard/cards/compile.py` (`_select`, `read_levels`)
- Test: `tests/cards/test_config.py`, `tests/cards/test_compile.py`

**Interfaces:**
- Produces: `CardConfig.surveys: list[str] = []` for distribution and opinion in standalone mode only; at least 2, no duplicates, no upper cap; rejected together with `anchor_round`; when `len(scenarios) > 1`, `cuts` must be `[[]]`. No `measure` field (support share for Party vote share, net score for Opinion).
- `_select` standalone with `surveys`: `used = [rounds named in config.surveys]`, one observation per survey so each cell carries its round; a survey missing from the context -> `unavailable` naming it; a survey lacking a question goes to `not_asked` like trend. `read_levels` adds every survey, so `card_blockers` sees all their levels.

- [ ] **Step 1: Write failing tests**: `test_surveys_only_for_distribution_and_opinion_standalone`, `test_surveys_need_two_and_exclude_anchor_round`, `test_several_questions_across_surveys_reject_cuts`, `test_survey_not_in_context_is_unavailable_naming_it`, `test_survey_without_the_scenario_is_not_asked_not_error`, `test_mixed_level_surveys_with_ac_num_cut_unavailable`, `test_no_common_coverage_without_a_seat_cut` (assert the existing `choose_coverage` result for AC+AC surveys cut by `district` and fix only if wrong), `test_existing_modes_unchanged`.
- [ ] **Step 2: Run** `.venv\Scripts\python.exe -m pytest tests/cards/test_config.py tests/cards/test_compile.py -q`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the field, validation and `_select`/`read_levels` change.
- [ ] **Step 4: Run** the full suite. Expected: all pass.
- [ ] **Step 5: Commit** explicit paths; message `feat: distribution and opinion cards read several surveys`.

### Task 3: Configure offers the card's own surveys

**Files:**
- Modify: `matbodh_dashboard/cards/configure/families.py` (descriptors), `matbodh_dashboard/cards/configure/options.py` (a `surveys` option source: the context's rounds by fieldwork start with level tag; for seat families only AC and PC rounds), `matbodh_dashboard/cards/configure/descriptor.py` (`disabled_when` plus `disabled_reason`), `web/src/api/types.ts`, `web/src/configure/` (surveys well widget, disabled cut builder, summary text)
- Test: `tests/cards/test_configure_options.py`, the existing descriptor tests, `web/src/configure/summary.test.ts`, `ConfigurePanel.test.tsx`, a widget test

**Interfaces:**
- Produces, in the "What to show" group of every family: **Survey** (`anchor_round`, single choice, default shown as "Context anchor: <name>", shown in standalone, compare and trend) and **Compared with survey** (`compare_round`, shown in compare mode, default "Context comparison: <name>"). For Party vote share and Opinion in standalone, Survey is a multi-select well (all the context's surveys, fieldwork order, level tag): one tick writes `anchor_round`, two or more write `surveys` (the layout rules apply), none = the context's anchor. Seat ranking, Group ranking and Seat benchmark list only AC and PC rounds. With a cut and several surveys or questions a one-line note under "Split by": "The table shows one survey (or question) at a time; choose it on the card". Several questions across several surveys: the cut builder is disabled with "Several questions across several surveys show overall only". `describeDraft` names the card's survey: `Shows <questions> in <survey>`, or `across <first three surveys> and N more`, with `(support share)` or `(net score)` only for several questions across surveys.
- The widget holds no level rules: validation errors and the "cannot run yet" alert are unchanged. A survey that did not ask a question surfaces through the existing `notes` list.
- Consumes: `CardConfig.anchor_round`, `.compare_round`, `.surveys` (Tasks 1 and 2).

- [ ] **Step 1: Write failing tests**: backend `test_survey_options_are_the_context_rounds_in_fieldwork_order`, `test_seat_families_offer_only_ac_and_pc_rounds`, `test_cuts_disabled_for_several_questions_across_surveys`; frontend `describeDraft` sentences (one named survey, five surveys -> "and 2 more", several questions -> measure named), `ConfigurePanel` shows Survey in standalone and Compared with survey only in compare, one tick writes `anchor_round` and two write `surveys`.
- [ ] **Step 2: Run** `.venv\Scripts\python.exe -m pytest tests/cards -q` and `cd web; npx vitest run src/configure`. Expected: FAIL.
- [ ] **Step 3: Implement** descriptors, options, widget and summary.
- [ ] **Step 4: Run** both suites and `npx tsc --noEmit -p .`. Expected: pass.
- [ ] **Step 5: Commit** explicit paths; message `feat: Configure picks a card's own surveys`.

### Task 4: The layout pivot

**Files:**
- Create: `web/src/cards/grid/layout.ts`
- Modify: `web/src/cards/grid/payloadToGrid.ts` (use `layoutGrid` when the payload has several surveys or several questions), `web/src/cards/ControlStrip.tsx`, `web/src/cards/families/_grid/GridBody.tsx`
- Test: `web/src/cards/grid/layout.test.ts`, `web/src/cards/ControlStrip.test.tsx`, `web/src/cards/families/_grid/GridBody.test.tsx`

**Interfaces:**
- Produces: `interface LayoutView { rowsAre: "surveys" | "breakdown"; question: string | null; survey: string | null }` and `layoutGrid(p: GridPayload, view: GridView & LayoutView): CellGrid` returning the table for the spec's layout table: (several questions, one survey, overall) columns = questions, rows = breakdown; (any cut with several questions) rows = cut values x breakdown, one question chosen by `view.question`; (one question, several surveys, overall) rows = surveys or breakdown with `rowsAre` swapping the axes; (any cut, several surveys) one survey chosen by `view.survey`; (several questions across several surveys) rows = surveys, columns = questions, the measure derived from the family. Cell values are copied from `p.cuts[].cells` (`row`, `column`, `round`, `lens`), never computed; absent cells are `{ cell: null }` with the payload's status flags.
- ControlStrip gains: an axis swap (one question across surveys, overall), a question selector and a survey selector (shown only when the layout needs a filter); all are display state, no request is sent.

- [ ] **Step 1: Write failing tests** in `layout.test.ts` with a hand-built payload of 2 questions x 2 surveys x 3 breakdown values (distinct numbers per cell so a wrong pivot fails): `columns are questions for several questions overall`, `a cut makes the second question a chosen filter`, `surveys become rows and swap with the breakdown`, `a cut with several surveys shows only the chosen survey`, `several questions across surveys show one measure per cell`, `a missing cell keeps the payload status`, plus a `GridBody` test that changing the question selector changes cells without a new request (assert the fetch mock call count).
- [ ] **Step 2: Run** `cd web; npx vitest run src/cards`. Expected: FAIL.
- [ ] **Step 3: Implement** `layoutGrid` (pure function over the payload) and the control wiring; `payloadToGrid` keeps its current output for one survey and one question.
- [ ] **Step 4: Run** `npx vitest run`, `npx tsc --noEmit -p .`. Expected: pass; the existing payloadToGrid and table tests are unchanged.
- [ ] **Step 5: Commit** explicit paths; message `feat: lay out several questions and surveys`.

### Task 5: Live check, end-to-end and docs

**Files:**
- Modify: `docs/open-items.md` (O-F10 row), `docs/testing.md` if it lists card rules; Playwright spec in `web/e2e/` following the existing card specs

- [ ] **Step 1: Live check, read-only, Uttar Pradesh**: first a seat ranking and a seat benchmark on a non-anchor AC round (the base equals the same card run with that round as the anchor), then a distribution card, `surveys` = `2027 VS CAPI R2` + `2029 LS NT CATI R1`, one party question overall; then two party questions x two surveys. Expected: per survey the per-round base equals the single-survey run's base; a cut with several surveys returns one survey's rows for the chosen filter. Report what was not run.
- [ ] **Step 2: Playwright**: build a several-surveys card in the browser, flip the axis, choose a question filter; expected no extra network request on a flip.
- [ ] **Step 3: Record** in `docs/open-items.md`: C built or not, the live result, what is unverified.
- [ ] **Step 4: Run** all suites (backend, vitest, tsc, Playwright). Expected: pass.
- [ ] **Step 5: Commit** explicit paths; message `docs: record multi-survey layouts`.

## Open questions for the owner (my calls, correctable)

- **Where a card chooses its surveys:** owner decision 2026-11-21: no new Show mode; every card can override the anchor (and compare) round, default the context's; several surveys only on Party vote share and Opinion cards.
- **Respondent filters** (the existing `filters` list) stay allowed with several-by-several; only cuts are disabled.
- **Survey count:** no cap on the card; I will report if the engine rejects a large set.
