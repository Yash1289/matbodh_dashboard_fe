# Multi-level context (sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A context can hold rounds of any survey levels; the server and the context picker derive each round's level from the catalogue instead of one context-wide `level`.

**Architecture:** `Catalogue` is keyed by `(state, base_name)` (`catalogue/store.py`), so a round name already identifies one level; no `{level, round}` pairs are needed (this replaces approach 1 in the spec; the spec is updated). `StateContext.level` becomes an optional legacy field the server ignores; consumers use `anchor_level(ctx, catalogue)`. Per-card level rules are sub-project B; here a card whose rounds span levels is blocked by one interim guard that B replaces.

**Tech Stack:** Python 3.11 / pydantic / pytest (`.venv\Scripts\python.exe -m pytest -q`), React 18 / TypeScript / Mantine 7 / vitest (`npx vitest run`, `npx tsc --noEmit -p .` in `web/`).

**Spec:** `docs/specs/2026-11-21-multi-survey-cards-design.md` (rule 1, build order A).

## Global Constraints

- Display state never goes into engine requests; the browser never computes numbers.
- Never invent levels, labels or availability: a round's level comes only from the catalogue (`CatalogueRound.level`).
- Single-level contexts behave exactly as today (existing tests keep passing with `level` removed from fixtures where trivial).
- Old URLs and stored last-contexts that still carry `level=` must keep opening; the value is ignored.
- Commit explicit paths only; never touch `docs/specs/2026-11-08-dashboard-design.md`; commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Do not create other planning markdown; record open points in `docs/open-items.md`.

## Review Focus

- An old URL / stored context with `level=ac` and rounds still opens (level ignored).
- A context whose rounds were removed from the catalogue: stays invalid with a named-round error, not a crash.
- `version_mode=matched` with a zone or state-wide round in the set: clear error naming the round.
- A card whose anchor and compare rounds are of different levels: unavailable with a reason, never a wrong table.
- A remembered last-context spanning several levels is offered only if every round still exists.

---

### Task 1: Server derives levels from the catalogue

**Files:**
- Modify: `matbodh_dashboard/catalogue/store.py` (add to `Catalogue`), `matbodh_dashboard/context.py`, `matbodh_dashboard/capability.py`
- Test: `tests/catalogue/test_store.py`, `tests/test_context.py`

**Interfaces:**
- Produces: `Catalogue.level_of(state: str, base_name: str) -> str` (raises `RoundNotFound`); `Catalogue.levels_of(state: str, names: Sequence[str]) -> tuple[str, ...]` (unique, ordered ac, pc, zone, state); `StateContext.level: Literal["ac","pc","zone","state"] | None = None`; `capability.anchor_level(ctx: StateContext, catalogue: Catalogue) -> str` (level of `resolve_anchor`); `capability.round_level_blockers(levels: Sequence[str]) -> list[str]` (one message "this card reads surveys of different levels (AC, STATE); ..." when more than one distinct level, else `[]`).

- [ ] **Step 1: Write failing tests.** `test_level_of_and_levels_of` (fixture with an AC, a PC and a state round: `levels_of(state, [pc, ac]) == ("ac", "pc")`, `level_of(state, "missing")` raises `RoundNotFound`); `test_context_without_level_validates`; `test_validate_context_allows_mixed_levels` (AC + PC + state rounds: `validate_context(...) == []`); `test_validate_context_matched_rejects_zone_round` (matched with a state round: one error containing the round name and "matched"); `test_unknown_round_still_reported`; `test_anchor_level_is_level_of_resolved_anchor` (explicit anchor on a PC round in a mixed context returns `"pc"`; no anchor returns the latest round's level); `test_round_level_blockers` (`["ac"]` -> `[]`, `["ac","state"]` -> one message mentioning both).
- [ ] **Step 2: Run** `.venv\Scripts\python.exe -m pytest tests/catalogue/test_store.py tests/test_context.py -q`. Expected: FAIL (names undefined).
- [ ] **Step 3: Implement** the interfaces above. In `validate_context` delete the "rounds must share one level" and "context level does not match" errors; replace the `ctx.level` version-mode check with one per found round: error `f"version mode {mode!r} is not available for {name!r} ({level} level)"` when the mode is not in `capabilities(round.level).version_modes`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add` the five files; message `feat: derive survey levels per round from the catalogue`.

### Task 2: Cards use the anchor's level and block mixed-level reads

**Files:**
- Modify: every `ctx.level` consumer: `matbodh_dashboard/cards/compile.py:184`, `cards/ranking/compile.py:72-75`, `cards/benchmark/compile.py:78-84,157`, `cards/relationship/compile.py:46`, `cards/configure/options.py:146-148`; plus any cohort code that receives `ctx.level`
- Test: `tests/cards/test_compile.py`, `tests/cards/test_ranking_compile.py`, `tests/cards/test_benchmark_compile.py`, `tests/cards/test_relationship_compile.py`, `tests/cards/test_configure_options.py`

**Interfaces:**
- Consumes: `anchor_level`, `round_level_blockers` (Task 1).
- Produces: nothing new; every card compile path reads `anchor_level(ctx, catalogue)` where it read `ctx.level`, and appends `round_level_blockers([r.dataset.level for r in rounds the card reads])` to its unavailable reasons (grid cell reason keyed as the file already keys its other blockers).

- [ ] **Step 1: Write failing tests**, one per family file: `test_card_with_anchor_and_compare_of_different_levels_is_unavailable` (anchor AC round, compare PC round: the family's grid is unavailable and the reason contains "different levels"); in `test_configure_options.py` `test_options_follow_anchor_level` (context with a PC anchor offers the PC geo slices).
- [ ] **Step 2: Run** `.venv\Scripts\python.exe -m pytest tests/cards -q`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** by replacing each `ctx.level` use with `anchor_level(ctx, catalogue)` (the catalogue is already in scope in these functions; thread it in where it is not) and adding the guard. Remove `level=` from test fixtures only where the failure is the missing field; do not weaken assertions.
- [ ] **Step 4: Run** `.venv\Scripts\python.exe -m pytest -q`. Expected: all pass (the pre-existing count plus the new tests).
- [ ] **Step 5: Commit** explicit paths; message `feat: cards read the anchor round's level and block mixed-level reads`.

### Task 3: URL and remembered context without `level`

**Files:**
- Modify: `web/src/api/types.ts` (`StateContext`: delete `level`), `web/src/context/urlContext.ts`, `web/src/context/lastContext.ts` (no change expected), create `web/src/context/levels.ts`
- Test: `web/src/context/urlContext.test.tsx`, `web/src/context/lastContext.test.ts`, create `web/src/context/levels.test.ts`

**Interfaces:**
- Produces in `levels.ts`: `levelOfRound(surveys: SurveysResponse, name: string): Level | null`; `levelsOf(ctx: StateContext, surveys: SurveysResponse): Level[]` (unique, order ac, pc, zone, state); `isOffered(ctx: StateContext, surveys: SurveysResponse): boolean` (rounds non-empty and every round exists at some level; replaces the two copies of `stillValid` in `ContextStep.tsx` and `pages/HomePage.tsx`).
- `parseContext` requires only `state` and at least one `rounds`; ignores a `level` param. `serialiseContext` no longer writes `level`, and still deletes a stale `level` key from the base params.

- [ ] **Step 1: Write failing tests.** `parseContext` of `?state=UP&level=ac&rounds=R1` returns a context with no `level` property; of `?state=UP&rounds=R1&rounds=R2` parses; `serialiseContext(...).has("level") === false` even when the base params had `level`; `levelsOf` of a context over an AC and a state round returns `["ac","state"]`; `isOffered` false when one round is missing.
- [ ] **Step 2: Run** `npx vitest run src/context` (in `web/`). Expected: FAIL.
- [ ] **Step 3: Implement** as specified; replace both `stillValid` functions with `isOffered`.
- [ ] **Step 4: Run** `npx vitest run src/context src/pages` and `npx tsc --noEmit -p .`. Expected: pass (tsc errors from other `ctx.level` readers are fixed in Tasks 4-5; do them before this check or leave this step's tsc to Task 5).
- [ ] **Step 5: Commit** explicit paths; message `feat: context in the URL carries rounds only; levels come from the catalogue`.

### Task 4: Summary shows the levels of the chosen rounds

**Files:**
- Modify: `web/src/context/summary.ts`
- Test: `web/src/context/summary.test.ts`

**Interfaces:**
- Consumes: `levelsOf`, `levelOfRound` (Task 3).
- Produces: `contextParts` where the `level` chip text is the levels joined with ` + ` (`AC level`, `PC + STATE level`; state-wide shown as `Statewide`), rounds are collected from every level's groups (group name shown once, suffixed ` (PC)` etc. only when the context spans more than one level), and the version chip reads `Normal only` only when no round is AC or PC.

- [ ] **Step 1: Write failing tests**: single-level summaries are unchanged (keep the existing expectations); a context over an AC and a PC round yields a level chip `AC + PC level`; a context of only zone and state rounds gives `Normal only`; a mixed context with an AC round gives the extrapolated/matched text.
- [ ] **Step 2: Run** `npx vitest run src/context/summary.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `summary.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** explicit paths; message `feat: context summary names every level in use`.

### Task 5: Context dialog picks rounds across levels

**Files:**
- Modify: `web/src/context/ContextDialog.tsx`, `web/src/context/ContextDialog.module.css` (only if a level heading needs style)
- Test: `web/src/context/ContextBar.test.tsx`, `web/src/context/ContextStep.test.tsx`

**Interfaces:**
- Consumes: `levelOfRound`, `levelsOf` (Task 3).
- Produces: a dialog with no "Survey level" select. After a state is chosen it lists every level that has rounds as its own labelled section (`LEVEL_LABEL`), each with its series groups as today. `draft` has no `level`. `canApply` needs at least one selected round. The "Seat coverage" block shows when any selected round is AC or PC. The progress count (`onProgress`) and the step status text read "Choose at least one round to continue." My calls: rounds are ordered level by level (ac, pc, zone, state) then by group; when the selected rounds span more than one level the dialog always sends an explicit `anchor_round` (the UI's order cannot be assumed to match the server's latest-by-sort-key).

- [ ] **Step 1: Write failing tests** (extend the existing component tests, which use the survey fixtures in `web/src/test/fixtures`; add an AC + state fixture if none has two levels): choosing a state shows sections for each level with no level select present; selecting an AC and a state round and pressing Apply calls `onApply` with both names in `rounds`, an explicit `anchor_round`, and no `level` key; seat-coverage appears only when an AC/PC round is selected; Apply is disabled with nothing selected.
- [ ] **Step 2: Run** `npx vitest run src/context`. Expected: FAIL.
- [ ] **Step 3: Implement** the changes above in `ContextDialog.tsx`.
- [ ] **Step 4: Run** `npx vitest run`, `npx tsc --noEmit -p .` and `npx playwright test`. Expected: all pass; update e2e fixtures that set `level` in the URL only if they fail for that reason.
- [ ] **Step 5: Commit** explicit paths; message `feat: pick rounds of any survey level in one context`.

### Task 6: Verification and docs

**Files:**
- Modify: `docs/open-items.md`, `docs/specs/2026-11-21-multi-survey-cards-design.md` (approach A note), `docs/testing.md` only if it lists context fields

- [ ] **Step 1: Live check, read-only, Uttar Pradesh:** with the API and worker restarted, open a context of one AC round and one state-wide round; confirm the bar summary shows both levels, and that a distribution card anchored on the AC round with the state round as compare shows the "different levels" reason (B will lift this for non-seat cards). Report anything not run.
- [ ] **Step 2: Record** in `docs/open-items.md`: A built, interim mixed-level guard to be replaced by B, and the spec's per-round-pairs approach superseded by catalogue-keyed names.
- [ ] **Step 3: Commit** explicit paths; message `docs: record multi-level context`.
