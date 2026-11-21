# Per-card level rules (sub-project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** What a card offers depends on the levels of the surveys it reads: distribution and opinion cards may read mixed levels, zone / party-zone / district cuts work on zone and state-wide surveys, and seat identifiers stay AC/PC only.

**Architecture:** `capability.py` gets one per-card check over the set of levels read (`card_blockers`) in place of the single-level `template_blockers` call and the interim `round_level_blockers` guard. The engine change that allows zone/district cuts on zone and state collections is already on `MatBodh-Dash` branch `feat/zone-state-geographic-cuts` (validation.py, tests/test_zone_state_geography.py). Ranking, benchmark, relationship, gender-differential and demographic-ranking cards keep their single-level rule (engine rules: seat features need one seat level; the other engine paths are unverified across levels).

**Tech Stack:** Python 3.11 / pydantic / pytest (`.venv\Scripts\python.exe -m pytest -q`); no frontend change (unavailable reasons already reach the card).

**Spec:** `docs/specs/2026-11-21-multi-survey-cards-design.md` (rules 1-3). Engine rules: `MatBodh-Dash/docs/context/geography.md`.

## Global Constraints

- Never invent availability: a cut is offered only where the engine table (`MatBodh-Dash/matbodh_dash/validation.py` `CAPABILITIES`) and the dataset's listed fields allow it.
- Zone and state collections: `zone`, `party_zone`, `district` allowed; `ac_num`, `pc_num` never; independent coverage only (no `common`).
- PC collections: `pc_num` and the PC zone only; PC mixed with any other level offers no geographic cut (the engine needs a PC-zone footprint for that).
- Seat identifiers (`ac_num`, `pc_num`) need every read survey to be the same single level.
- Single-level contexts and cards behave exactly as before; existing tests keep passing.
- Commit explicit paths only; never touch `docs/specs/2026-11-08-dashboard-design.md`; commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Distribution card, AC anchor + state compare, overall cut: builds (mixed levels allowed when there is no geographic cut).
- Same card with a `district` cut: builds, runs with independent coverage, never `common` (the engine would refuse `completed_acs` for a state survey).
- Same card with an `ac_num` cut, or a `pc_num` cut over AC+PC: unavailable with a reason naming the levels.
- A state-wide survey that does not list `ac_num`: a zone/district cut is unavailable with that reason, not an engine error.
- AC + PC + a zone cut: unavailable (engine needs the PC-zone footprint for mixed AC/PC zone views).

---

### Task 1: One per-card level check

**Files:**
- Modify: `matbodh_dashboard/capability.py`, `matbodh_dashboard/cards/config.py` (add `MIXED_LEVEL_FAMILIES = frozenset({"distribution", "opinion"})`)
- Test: `tests/test_capability.py` (create if absent; follow `tests/test_context.py` fixtures)

**Interfaces:**
- Produces: `card_blockers(min_level: str, slices: Sequence[str], levels: Sequence[str], *, mixed_ok: bool) -> list[str]`; `SEAT_SLICES = frozenset({"ac_num", "pc_num"})`; `_CAPABILITIES["zone"|"state"].geo_slices == frozenset({"zone", "party_zone", "district"})`; `template_blockers` keeps its signature and result for a single level (existing callers and tests unchanged).
- Behaviour: `levels` empty -> `[]`. Not `mixed_ok` and more than one distinct level -> the existing `round_level_blockers` message plus `template_blockers` for the first level. `mixed_ok`: `min_level` is checked against each level (existing wording); each slice in `GEO_SLICES` must be allowed for every distinct level (reason: `Slice 'district' is not available for PC-level surveys`); any slice in `SEAT_SLICES` with more than one distinct level -> `Seat identifiers need surveys of one level; this card reads AC, STATE`; PC together with another level and any geographic slice -> `Geographic cuts need the surveys to share a geography; this card reads PC and AC`.

- [ ] **Step 1: Write failing tests**: `test_zone_and_state_allow_zone_party_zone_district`, `test_zone_and_state_never_allow_seat_identifiers`, `test_mixed_ac_and_state_allows_overall_and_district_cuts_when_mixed_ok`, `test_mixed_levels_blocked_when_not_mixed_ok`, `test_seat_identifiers_blocked_over_mixed_levels`, `test_pc_with_ac_blocks_a_zone_cut`, `test_single_level_template_blockers_unchanged` (a PC survey still blocks `district`; an AC survey allows `party_zone`).
- [ ] **Step 2: Run** `.venv\Scripts\python.exe -m pytest tests/test_capability.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** `card_blockers` and the table change above in `capability.py`; add `MIXED_LEVEL_FAMILIES` to `cards/config.py`.
- [ ] **Step 4: Run** the same command and then the full suite. Expected: PASS, 779+ passing.
- [ ] **Step 5: Commit** `git add matbodh_dashboard/capability.py matbodh_dashboard/cards/config.py tests/test_capability.py`; message `feat: one per-card survey level check`.

### Task 2: The grid compiler uses it, and keeps independent coverage

**Files:**
- Modify: `matbodh_dashboard/cards/compile.py` (the `template_blockers`/`round_level_blockers` call near line 195, the coverage choice near line 218)
- Test: `tests/cards/test_compile.py`, `tests/api/test_app.py`

**Interfaces:**
- Consumes: `card_blockers`, `MIXED_LEVEL_FAMILIES` (Task 1); `read_levels` (exists in this file).
- Produces: for a distribution or opinion card the blockers are `card_blockers(config.requires.min_level, fields, read_levels(...), mixed_ok=True)`; every other grid family passes `mixed_ok=False`. After the round selection, a zone or state round without `ac_num` among its `dataset.fields` makes every master-sourced geographic or seat-attribute field unavailable with `Field 'district' needs ac_num in <round>` (a master field is one `field_available` accepts through `_engine_master_fields`, not through `dataset.fields`). When any selected round is zone or state level, coverage is `"independent"` whatever `choose_coverage` returns.

- [ ] **Step 1: Write failing tests** with the fixture catalogue extended by a PC and a state dataset (`tests/test_context.py::catalogue_with_pc` shows how): `test_mixed_ac_state_overall_distribution_builds`, `test_mixed_ac_state_district_cut_uses_independent_coverage` (the request handed to `build_request` has `coverage_mode == "independent"`), `test_ac_num_cut_over_ac_and_state_is_unavailable`, `test_state_round_without_ac_num_blocks_a_district_cut` (dataset row with `available_fields` lacking `ac_num`), `test_ac_pc_zone_cut_is_unavailable`, `test_gender_differential_over_two_levels_stays_blocked`.
- [ ] **Step 2: Run** `.venv\Scripts\python.exe -m pytest tests/cards/test_compile.py -q`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** as specified; remove the now-redundant `round_level_blockers` call for the grid compiler only (ranking, benchmark, relationship keep it).
- [ ] **Step 4: Run** `.venv\Scripts\python.exe -m pytest -q`. Expected: all pass.
- [ ] **Step 5: Commit** explicit paths; message `feat: distribution and opinion cards read mixed survey levels`.

### Task 3: Configure offers the same cuts the compiler accepts

**Files:**
- Modify: `matbodh_dashboard/cards/configure/options.py` (`_fields`)
- Test: `tests/cards/test_configure_options.py`

**Interfaces:**
- Consumes: `card_blockers` / the geo table (Task 1).
- Produces: `_fields` computes `levels = [r.dataset.level for r in read]` and offers a geographic field only when `card_blockers(...)` for that single field is empty; seat-attribute fields with no geography (incumbent party, caste, gender, category) are offered at any level whose read rounds list `ac_num` (PC keeps its existing `_pc_attributes` rule); `use="seat_attribute"` (seat ranking filters and partitions) still requires the seat levels `ac` or `pc` as today.

- [ ] **Step 1: Write failing tests**: `test_state_survey_offers_zone_party_zone_district_but_not_ac_num`, `test_state_survey_offers_incumbent_party_cut`, `test_ac_plus_state_offers_district_but_not_ac_num`, `test_seat_ranking_filters_still_need_a_seat_level`, `test_pc_survey_options_unchanged`.
- [ ] **Step 2: Run** `.venv\Scripts\python.exe -m pytest tests/cards/test_configure_options.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** in `_fields`.
- [ ] **Step 4: Run** the full suite. Expected: pass.
- [ ] **Step 5: Commit** explicit paths; message `feat: Configure offers geographic cuts per survey level`.

### Task 4: Live check and docs

**Files:**
- Modify: `docs/open-items.md` (O-F10 row), `docs/testing.md` only if it lists capability rules

- [ ] **Step 1: Live check, read-only, Uttar Pradesh** (restart not needed; the dashboard venv imports the engine branch): with `scripts/smoke_card.py` and an inline distribution card cut by `zone` then `district`, run on one state-wide round (`2029 LS NT CATI R1`) and on that round beside an AC round as compare. Expected: no engine error; per cut, `weighted_denominator` summed over zones/districts equals the overall base, support shares per group sum to 100, and the compare run reports `independent` coverage. Report what was not run (PC, relationship, ranking).
- [ ] **Step 2: Record** in `docs/open-items.md`: B built, engine change on `MatBodh-Dash` branch `feat/zone-state-geographic-cuts` (not merged), families still single-level, the live-check result.
- [ ] **Step 3: Commit** explicit paths; message `docs: record per-card level rules`.
