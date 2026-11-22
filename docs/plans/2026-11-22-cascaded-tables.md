# Cascaded Tables, Pop % and Hierarchical Display Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grid cards can show nested cuts as one tree (Cascaded density) with a fixed second Pop % column, ordered by plain YAML rules at every level, with caste clubbing keyed to the anchor round.

**Architecture:** The translator (`cards/translate.py`) orders rows at every level from the rule registry and carries the anchor round's `populations[].composition_share` as a new `Cut.population` list. The front end merges a chain of nested cuts into one virtual cut and draws indented rows. Compile passes the anchor round as the caste-clubbing reference for every job. No arithmetic outside ClickHouse.

**Tech Stack:** Python (pydantic, pytest, PyYAML), React + TypeScript (Mantine, vitest, Playwright).

**Spec:** `docs/specs/2026-11-22-cascaded-tables-design.md`

## Global Constraints

- ClickHouse does the numbers; Python orchestrates; the browser pivots and copies. Parents are engine rows, never sums.
- Missing value is a dash, never zero. No "pp" in any label.
- Rules live only in `config/presentation/*.yaml`; no field-specific branches in code (no `if field == "gender"`). `registry.py` is the only YAML reader.
- Engine: caste clubbing reference must be one of the request's observations (`MatBodh-Dash/matbodh_dash/caste_clubbing.py:34`); missing reference geography is an error.
- Never touch the owner's uncommitted `docs/specs/2026-11-08-dashboard-design.md`. Commit explicit paths only; messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Tests: backend `.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider`; front end `cd web; npx vitest run`, `npx tsc --noEmit -p .`, `npx playwright test`.

## Review Focus

- A cut set whose parent set is absent (`[a,b]` only): Cascaded disabled with a reason, no crash (Task 5).
- Null value at a child level (`gender=~null`): sorts last in its level, never dropped (Task 2).
- Gender `Other` hidden at a child level removes the child row, not just top-level rows (Task 2).
- Anchor has no population item for a row: Pop % is a dash, never another survey's value (Task 3).
- Anchor lacks `category`/`caste` or a geography the card reads: card unavailable naming the round, no silent per-survey clubbing (Task 4).

---

### Task 1: Decide the several-surveys caste-reference mechanism

Gate task: Task 4 depends on its outcome. No product code.

**Files:**
- Create: `scratchpad/caste_reference_probe.py` (session scratchpad, not committed)
- Modify: `docs/specs/2026-11-22-cascaded-tables-design.md` (record the decision under "Caste reference")

**Interfaces:**
- Produces: a recorded choice, `MECHANISM = "extra_observation" | "single_job" | "unavailable"`, used by Task 4.

- [ ] **Step 1:** Using the engine offline resolver the way `tests/cards/test_ranking_compile*.py` does, build a request with `observations=[survey_r, anchor_r]`, `caste_clubbing.reference_observation=anchor_r.id` and a scenario the anchor did not ask. Record whether the engine accepts it.
- [ ] **Step 2:** Run the same request live and read-only on UP (aggregates only, `ENGINE_ENV_FILE=../MatBodh-Dash/.env`, never print `.env`): two UP PC rounds, `[category, caste]` cuts, clubbing on. Record whether rows of both observations return and whether the caste list for the non-anchor round equals the anchor's.
- [ ] **Step 3:** Choose by this rule and write it in the spec: engine accepts the extra observation with a scenario it lacks → `extra_observation`; otherwise a single multi-observation job is viable only if no survey skipped a question → `single_job`; otherwise → `unavailable` (the card says several surveys with clubbing need every survey to ask the same questions). Report the result to the owner before Task 4 if it is `unavailable`.

### Task 2: Hierarchical row order from the registry

**Files:**
- Modify: `matbodh_dashboard/cards/translate.py` (`_apply_row_rules`, `_hide_multi_dimension_rows`)
- Modify: `matbodh_dashboard/registry.py` (add one method only if the translator needs it)
- Modify: `config/presentation/uttar-pradesh.yaml`, `config/presentation/global.yaml`
- Test: `tests/cards/test_translate_row_order.py`, `tests/test_registry.py` (or the existing registry test file)

**Interfaces:**
- Consumes: `RuleSet.order(field, values, *, states, within=None) -> list[str]`, `RuleSet.hidden_count`.
- Produces: `_Translator._apply_row_rules()` orders `cut.rows` of every cut, any number of dimensions; the level-`i` value is ordered with `within=<value of dimension i-1>` (none for the first level). Null values (`~null`) sort last in their level. A row is dropped when any level's value is hidden.

- [ ] **Step 1: Write failing tests** in `test_translate_row_order.py`, using `translate_helpers.mini_result`/`mini_row`/`dim` and a `RuleSet` built from a temp YAML dir via `load_rules`:
  - `test_two_level_cut_orders_children_inside_each_parent`: rules give `age_group` order `[18-25, 26-35, 60+]` and `gender` order `[Male, Female]`; engine rows arrive shuffled; assert the cut's row keys are `age_group=18-25`, `…|gender=Male`, `…|gender=Female`, `age_group=26-35`, … in that order (parents are separate cuts, so assert each cut's order and the first-level order in the coarser cut).
  - `test_within_rule_orders_castes_per_category`: a `caste` rule with `within: GEN, order: [Brahmin, Thakur], pin_last: [Other GEN]` and a within-less `caste` rule `pin_last: ["Other *"]`; assert GEN castes read Brahmin, Thakur, others alphabetical, `Other GEN` last, and a category with no `within` rule puts `Other NY-OBC` last.
  - `test_null_child_sorts_last_and_stays`: a row `…|gender=~null` is last among its parent's children and present.
  - `test_hidden_gender_other_drops_child_rows`: global `gender hidden: [Other]`; child rows with `Other` are gone from `cut.rows`, `cut.cells`, `hidden_count` increases by that number.
  - `test_single_dimension_cut_unchanged`: an existing 1D ordering assertion keeps passing.
- [ ] **Step 2:** Run `pytest tests/cards/test_translate_row_order.py -v`; expect the new tests FAIL (multi-dimension rows keep engine order).
- [ ] **Step 3:** Implement the general rule in `_apply_row_rules`: for each cut, group row keys by their parent prefix, order each level's values with `rules.order(dim, values, states=[state], within=parent_value)`, hide via the same call's absence, and sort rows by the tuple of level ranks. Replace `_hide_multi_dimension_rows` (its `order(...) != [value]` test is a hiding check in disguise; reuse one helper for both). One short function per concern, no field names.
- [ ] **Step 4:** Add the UP entries to `config/presentation/uttar-pradesh.yaml`: `gender` order `[Male, Female]`; `category` order `[GEN, Yadav, NY-OBC, Jatav, NJ-SC/ST, Muslim]`; `age_group` order = the real UP labels read from data (youngest first, `60+` last; if a label is missing from the data say so, never invent); a state-independent `caste` rule `pin_last: ["Other *"]` in `global.yaml`. Each entry gets a one-line comment saying what it does. Keep `gender hidden: [Other]` in `global.yaml`.
- [ ] **Step 5:** Run backend tests; expect PASS. Commit `matbodh_dashboard/cards/translate.py`, `matbodh_dashboard/registry.py` (if changed), the two YAML files and the tests.

### Task 3: Pop % in the payload

**Files:**
- Modify: `matbodh_dashboard/cards/payload.py` (`PopulationValue`, `Cut.population`, `Capabilities.population`)
- Modify: `matbodh_dashboard/cards/translate.py` (`_population_rows`, `_Cut.build`)
- Modify: `matbodh_dashboard/cards/families/*.py` (set `population=True` for families whose field map declares `populations`)
- Modify: `web/src/api/types.ts`; regenerate fixtures under `web/src/test/fixtures` the way `tests/cards/test_configure_descriptors.py` documents
- Test: `tests/cards/test_translate_population.py`

**Interfaces:**
- Produces: `PopulationValue(row: str, value: float | None, status: str)`; `Cut.population: list[PopulationValue]` (default empty); `Capabilities.population: bool = False`. Mirrored in `types.ts` as `PopulationValue`, `Cut.population`, `Capabilities.population`.

- [ ] **Step 1: Write failing tests:**
  - `test_population_comes_from_anchor_round_only`: two observations with different `composition_share` for the same row; `anchor` = o2; assert `Cut.population` has o2's value, not o1's.
  - `test_population_value_is_engine_value_unchanged`: value equals the item's `composition_share` exactly (parent and child rows both).
  - `test_anchor_without_population_item_gives_no_entry`: row present from `rows` but no anchor `populations` item → no `PopulationValue` for it (front end shows a dash).
  - `test_population_capability_matches_field_map`: for every grid family, `capabilities.population == ("populations" in load_field_map(family).arrays)`.
- [ ] **Step 2:** Run them; expect FAIL (field not defined).
- [ ] **Step 3:** Implement: `_population_rows` appends one `PopulationValue` per `(cut, row)` for items with `observation_id == tc.anchor` (first item wins), `status` `"available"` or `"null_value"`; keep creating rows as today for `used_obs`. Add the model fields with `_Strict` defaults so existing payloads still validate. Mirror in `types.ts`.
- [ ] **Step 4:** Regenerate the front-end fixtures; run backend and `npx vitest run`; expect PASS.
- [ ] **Step 5:** Commit the touched files explicitly.

### Task 4: Anchor-based caste reference and clubbing default

Depends on Task 1's recorded `MECHANISM`.

**Files:**
- Modify: `matbodh_dashboard/cards/compile.py:263-306`, `matbodh_dashboard/cards/config.py` (`caste_clubbing`), `matbodh_dashboard/cards/configure/families.py:88`, `matbodh_dashboard/runner/service.py` (results merge, only if `extra_observation`), the front-end Configure toggle that reads `caste_clubbing`
- Test: `tests/cards/test_caste_reference.py`

**Interfaces:**
- Produces: `CardConfig.caste_clubbing: bool | None = None` (None = auto) and `CardConfig.clubs_castes() -> bool` (explicit value, else True when any cut contains `caste`). The compile reference is always the card's anchor round.

- [ ] **Step 1: Write failing tests** (offline compile, no database):
  - `test_reference_is_anchor_even_in_compare_mode`: compare card, anchor o2, compare o1: `request["caste_clubbing"]["reference_observation"] == "o2"` (today it is the compare reference).
  - `test_every_survey_job_uses_the_anchor_reference`: several-surveys card, three surveys: every job's request carries the anchor as `reference_observation`; with `extra_observation` each job lists the anchor among its observations; with `single_job` there is one job; with `unavailable` the plan has the reason naming the round.
  - `test_auto_clubbing_on_for_caste_cut_only`: `caste_clubbing=None` + cuts with `caste` → `clubs_castes()` True; without `caste` → False; explicit `False` stays False; explicit `True` without a caste cut still fails validation as today.
  - `test_anchor_missing_category_or_caste_is_unavailable_and_named`: anchor dataset lacks `caste` → `unavailable` reason names that round.
  - (`extra_observation` only) `test_extra_observation_rows_dropped_from_other_surveys`: merged results contain each survey's rows once; the anchor's rows appear once even when the anchor is also a chosen survey.
- [ ] **Step 2:** Run them; expect FAIL.
- [ ] **Step 3:** Implement per the recorded mechanism: `caste_reference = anchor_round` (drop the `selection.reference` and `selection.used[-1]` fallbacks; if the anchor is not readable, mark the card unavailable naming it). Replace the `config.caste_clubbing` reads in `compile.py` with `config.clubs_castes()`. In the Configure toggle, show `value ?? hasCasteCut`. Do not add a per-survey fallback.
- [ ] **Step 4:** Run backend and front-end suites; expect PASS.
- [ ] **Step 5:** Commit the touched files explicitly.

### Task 5: Cascaded density, tree rows and the Pop % column (front end)

**Files:**
- Create: `web/src/cards/grid/cascade.ts`, `web/src/cards/grid/cascade.test.ts`
- Modify: `web/src/cards/grid/payloadToGrid.ts`, `web/src/cards/view.ts`, `web/src/cells/parts.ts`, `web/src/cards/ControlStrip.tsx`, `web/src/cards/families/_grid/GridBody.tsx`, `web/src/table/grid.ts` (`Header.depth?`), `web/src/table/CompositeTable.tsx` (indent), `web/src/api/types.ts` (`GridDensity`)
- Test: the `.test.ts(x)` beside each, plus one Playwright spec in the existing suite

**Interfaces:**
- Produces:
  - `type GridDensity = "standard" | "detailed" | "cascaded"` in `types.ts`; `FamilyView.density: GridDensity`; ranking keeps `Density`.
  - `cascadable(cuts: Cut[]): { ok: true; chain: Cut[] } | { ok: false; reason: string }` in `cascade.ts`.
  - `cascadePayload(p: GridPayload): GridPayload | null`: a copy whose `cuts` is one virtual cut `id: "cascade"` holding the chain's rows (tree order), cells, deltas, bases and population concatenated; `null` when not cascadable.
  - `Header.depth?: number`; `GridView.cascade?: boolean` (row label = last label only, `depth` set from the number of labels minus one).
  - `initialView(p)` returns `density: "cascaded"` when `cascadable(p.cuts).ok`, else `"standard"`.

- [ ] **Step 1: Write failing tests** in `cascade.test.ts`:
  - `cascadable_accepts_chain`: cuts `[age_group]`, `[age_group, gender]` → ok; `[age_group, gender]` alone → `{ok:false}` with a reason mentioning the missing parent; `[age_group]`, `[gender]` → not ok; first field a seat field → not ok with its own reason.
  - `tree_order_parent_then_children`: rows come out `age_group=18-25`, its two gender rows, `age_group=26-35`, …; children keep the payload (backend) order.
  - `single_child_same_label_collapses`: category `Yadav` with one caste `Yadav` → one row (the parent's); category `GEN` with castes → parent plus children; a parent with one differently named child keeps both.
  - `orphan_child_stays_visible`: a child row whose parent row is absent appears at top level.
  - `values_are_payload_values`: the parent row's cell equals the coarser cut's cell, not the children's sum.
  - In `payloadToGrid.test.ts`: `population_column_is_first_and_dash_when_missing` (column key `"__pop"`, label `Pop %`, value from `cut.population`, a row without an entry shows `cell: null`; absent entirely when `meta.capabilities.population` is false) and `cascade_labels_use_last_label_and_depth`.
  - In `view.test.ts`: `initialView_cascaded_when_cascadable`, `settled_drops_cascaded_when_cuts_change`, `settled_drops_sort_and_transpose_while_cascaded`.
  - In `GridBody.test.tsx`: `search_keeps_matching_child_and_its_parent`.
  - In `parts.test.ts`: `partsFor` no longer special-cases a compact density (the `compact` test is removed).
- [ ] **Step 2:** Run `npx vitest run`; expect the new tests FAIL.
- [ ] **Step 3:** Implement `cascade.ts` (chain rule: each set extends the previous by exactly one field, every parent set present, first field not a seat field; tree order from row-key prefixes) with signatures above. In `payloadToGrid`, prepend the `__pop` Header and cells when `meta.capabilities.population` (values from `cut.population`; `Pop %` is excluded from the format rule so heat/diverging colours never apply to it). In `GridBody`, when `view.density === "cascaded"`, use `cascadePayload(payload)` and skip transpose, row sort and the cut selector; search filters labels then re-adds each kept row's ancestors. In `ControlStrip`, `DENSITIES` becomes Standard / Detailed / Cascaded with Cascaded disabled and carrying the `reason` when not cascadable; disable the Transpose and cut chips while cascaded. `CompositeTable` indents row headers by `depth`. Remove `compact` from `partsFor` for grids.
- [ ] **Step 4:** Run `npx vitest run`, `npx tsc --noEmit -p .`; expect PASS. Add the Playwright spec `cascaded.spec.ts`: open a mock card with cuts `[age_group]`, `[age_group, gender]`, assert the first body row is `18-25`, its next two rows are indented Male/Female, and the second header cell is `Pop %`; run `npx playwright test`.
- [ ] **Step 5:** Commit the touched files explicitly.

### Task 6: Single rule reader, rules guide, verification

**Files:**
- Modify: `matbodh_dashboard/api/app.py` (`get_presentation_rules`), `matbodh_dashboard/registry.py` (one method returning the `/api/presentation/{state}` body)
- Create: `docs/guides/display-rules.md`; update `docs/README.md` index and `docs/testing.md`
- Test: `tests/test_presentation_api.py`, `tests/test_registry.py`

**Interfaces:**
- Produces: `RuleSet.presentation(state: str) -> dict` returning exactly the keys the endpoint returns today (`state`, `rowOrder`, `columnOrder`, `pinLast`, `entityColors`); `get_presentation_rules` only calls it (with the existing defaults for a missing party rule).

- [ ] **Step 1: Write failing tests:** `test_endpoint_body_unchanged_for_existing_config` (the current `test_presentation_api.py` assertions still hold against the repo's real `config/`), `test_ruleset_presentation_matches_endpoint`, `test_invalid_rule_file_names_file_entry_and_key` (a YAML with an unknown key raises `ValueError` whose text contains the file name, the entry index and the key), `test_endpoint_includes_new_gender_age_category_orders_for_up`.
- [ ] **Step 2:** Run them; expect the new ones FAIL.
- [ ] **Step 3:** Implement `RuleSet.presentation` from the already-loaded rules; delete the second hand-written YAML parse in `app.py`. Write `docs/guides/display-rules.md`: one commented YAML example each for `order`, `pin_first`/`pin_last`, `within`, the `Other *` wildcard, `hidden`, `labels`, `colours`, with the UP gender, age, category and caste entries, and the layering rule (global, then state; state `order` replaces global for one state).
- [ ] **Step 4:** Run the full backend, front-end and Playwright suites; record counts against the baseline (backend 840, frontend 591, Playwright 14, `tsc` clean).
- [ ] **Step 5:** Live read-only check on UP (aggregates only): a category→caste cascade with two surveys. Confirm order, collapsed single-caste categories, identical caste membership in both survey columns, Pop % equal to the anchor's share. State which production checks were not run. Commit the touched files explicitly.
