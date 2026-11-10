# Card Foundation and Grid Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace State Pulse and the single-grid card pipeline with a modular card foundation plus three engine-faithful cards (Distribution, Opinion scorecard, Gender differential) that support standalone, compare and trend modes, lenses, cuts, and in-memory display controls.

**Architecture:** A typed `CardConfig` (YAML now, edited by Configure later) is compiled by shared code into one engine job per card. The existing runner, queue, cache and fingerprinting stay. A shared translator reshapes the engine result into a typed long-format `GridPayload` (numbers copied verbatim). A frontend `CardShell` plus a shared `GridBody` renders it, with display controls that never fetch.

**Tech Stack:** Python 3.10+, FastAPI, Pydantic v2, PyYAML, pytest; React 18, TypeScript 5.6 strict, Mantine 7.17, TanStack Table 8, Vitest, Playwright.

**Spec:** `docs/specs/2026-11-10-card-foundation-and-grid-family-design.md` (read it first; §numbers below refer to it).

**Spec amendments made while planning** (already applied to the spec): `Column.lenses` (a column can apply to only some lenses); coverage uses the existing `choose_coverage` (`common` or `independent`), not `reference_complete`; the Yes/No outcome domain is `boolean` (`default_scenarios()` in `matbodh_dash/catalog.py`).

## Global Constraints

- The engine owns every number: no sum, average, subtract, rescale or rank in Python or TypeScript. Translator and UI copy engine values unchanged.
- NULL is not zero: a missing value renders `—` with a reason, never `0`, `0.0` or `NaN`.
- Units come from the engine (`percentage`, `percentage_points`). Percent display uses the existing `formatPercent()`: `|v| >= 2.0` whole number with `%`, `|v| < 2.0` two decimals with `%`.
- Display controls (lens, cut, details, sort, transpose, format, order, density, search, hidden parties) never trigger a request.
- Round labels are series-qualified (`2027 VS CAPI R2`); bare `R1` only as a sub-header.
- Modes never combine: `standalone`, `compare` (two endpoints; value plus one engine delta per cell), `trend` (2 to 4 rounds, one scenario, pipes, no delta). A scenario is never a row. Gender differential supports `standalone` and `trend` only.
- Filters: `in` or `not_in`, at least one string value, one entry per field, AND across entries.
- Admin preset policy (weights, answers, parties, alliances, opinion weights, gender labels, competition exclusions, caste threshold) is never exposed or editable by a card.
- Automated tests never hit a production database. The live smoke check needs product-owner approval and is not run by this plan.
- Commit with explicit paths only (`git add <paths>`, never `git add -A` or `.`). The uncommitted edits to `ContextBar.tsx`, `ContextBar.test.tsx`, `ContextDialog.*`, `docs/specs/2026-11-08-dashboard-design.md` and the untracked `CLAUDE.md`, `prototypes/`, `uv.lock`, `.codegraph/` must stay uncommitted.
- Commands: backend `.venv/Scripts/python.exe -m pytest <path> -q` (from `matbodh-dashboard/`); frontend `cd web && npx vitest run <path>`; typecheck `cd web && npm run typecheck`. A skipped test is not a pass.

## Review Focus

Inputs the spec implies but no obvious task would exercise; each has a test in the named task.

1. A row whose engine value is null while its group has other data: the cell is `—` with a reason, never `0` (Tasks 7, 10).
2. A genuine NULL dimension value versus an engine subtotal (`is_subtotal: true`): they are distinct rows (Task 7).
3. A group present only in `populations` (no outcome rows): it becomes a row of `—` cells (Task 7).
4. Trend where one selected round lacks the scenario: that round is left out of the request and shown as `—` with a not-asked reason, and the other rounds still render (Tasks 6, 7, 10).
5. A compare cell whose comparison status is `missing_target` or `missing_reference`: the delta is `—` with the reason, and the target value still shows when present (Tasks 7, 10, 12).

## File Structure

**Create (backend, `matbodh_dashboard/cards/`)**
- `config.py`: `CardConfig` models, validation, `load_cards`, `scenario_kind`, `comparison_kind`.
- `payload.py`: pydantic payload models (`GridPayload` and parts).
- `families/__init__.py`: `FamilySpec`, `LensSource`, `FAMILIES`, `get_family`, `family_meta`.
- `families/distribution.py`, `families/opinion.py`, `families/gender_differential.py`: lens tables and capabilities (data only).
- `field_map.py` and `field_maps/{distribution,opinion,gender_differential}.yaml`: key-to-role maps and the coverage checker.
- `compile.py`: `compile_card(...) -> RunPlan`. `translate.py`: `translate_grid(...) -> GridPayload`.
- `config/cards/cards.yaml`: seed cards.

**Create (frontend, `web/src/`)**
- `cards/grid/payloadToGrid.ts`, `cards/view.ts`, `cards/PopoverChip.tsx`, `cards/ControlStrip.tsx`, `cards/CardShell.tsx`, `cards/families/index.ts` (+ one thin folder per family), `cards/families/_grid/GridBody.tsx`, `cells/PipeCell.tsx`, `pages/CardsPage.tsx`.

**Modify:** `compiler/requests.py`, `compiler/plan.py`, `runner/service.py`, `bootstrap.py`, `api/app.py`, `web/src/api/types.ts`, `web/src/api/queries.ts`, `web/src/api/client.ts`, `web/src/table/{grid.ts,CompositeTable.tsx}`, `web/src/cells/format.ts`, `web/src/App.tsx`, `web/e2e/*`, `README.md`, `CLAUDE.md`.

**Delete:** `matbodh_dashboard/templates.py`, `config/templates/pulse.yaml`, `normalise/cells.py`, `web/src/pages/{StatePulse,CoverageStrip}.tsx` (+tests), `web/src/cards/{Card.tsx,CardToolbar.tsx,body/*}` (+tests), `scripts/smoke_state_pulse.py`, the `templates_pulse.json` and `run_*_done.json` fixtures, `web/e2e/state-pulse.spec.ts`. Keep `normalise/rows.py` (`from_benchmark` is for the benchmark sub-project), `InvestigationDrawer`, `MethodDrawer`, `CardFilterBar`.

---

### Task 1: Sample fixtures and loader

**Files:**
- Create: `tests/fixtures/engine_samples/*.json` (copied), `tests/cards/__init__.py`, `tests/cards/samples.py`
- Test: `tests/cards/test_samples.py`

**Interfaces:**
- Produces: `load_sample(name: str) -> dict`; `FAMILY_SAMPLES: dict[str, tuple[str, ...]]` with
  - `distribution`: `result.json, result_geo.json, result_overall.json, result_ac_1_across.json, result_caste_complex.json, result_ac_1_caste_all_final_ultimate_final.json`
  - `opinion`: `result_opinion.json, result_opinion_comp.json, result_opinion_comp_ac_1.json, result_opinion_comp_ultimate.json, result_ac_1_across.json`
  - `gender_differential`: `result_gd.json`

- [ ] **Step 1:** `git switch -c feat/card-foundation` (from the current branch; working-tree edits carry over untouched).
- [ ] **Step 2: Write the failing test** `test_every_family_sample_loads` in `tests/cards/test_samples.py`: for each family and file, `load_sample(name)` returns a dict containing `rows` and `contract` (distribution/opinion) or a non-empty `gender_differentials` (gender); `test_samples_are_aggregate_only`: no top-level key named `respondents`.
- [ ] **Step 3: Run** `.venv/Scripts/python.exe -m pytest tests/cards/test_samples.py -q`. Expected: FAIL (module missing).
- [ ] **Step 4:** Copy the 11 files listed above from `../MatBodh-Dash/sample-output/` into `tests/fixtures/engine_samples/` (`cp`). Do not copy `result_ac_1.json` (13 MB) or `result_gd_complex.json` (24 MB); Task 15 reads those from the sibling folder. Implement `load_sample` (UTF-8 `json.load`, relative to the fixtures dir) and `FAMILY_SAMPLES`.
- [ ] **Step 5: Run** the test. Expected: PASS.
- [ ] **Step 6: Commit** `git add tests/fixtures/engine_samples tests/cards/__init__.py tests/cards/samples.py tests/cards/test_samples.py` then `git commit -m "test(cards): add engine sample fixtures and loader"`.

---

### Task 2: `CardConfig` models, validation, loader

**Files:**
- Create: `matbodh_dashboard/cards/__init__.py`, `matbodh_dashboard/cards/config.py`, `config/cards/cards.yaml`
- Test: `tests/cards/test_config.py`

**Interfaces:**
- Produces (all pydantic v2, `extra="forbid"`, mirroring `templates._Strict`):
  - `Family = Literal["distribution","opinion","gender_differential"]`
  - `FilterSpec(field: str, operator: Literal["in","not_in"]="in", values: list[str])`
  - `Endpoint(round: str = "anchor", scenario: str)` (`round` is `anchor`, `compare` or a selected round base name)
  - `ComparisonConfig(mode: Literal["standalone","compare","trend"]="standalone", target: Endpoint|None=None, reference: Endpoint|None=None, delta_measures: list[str]=[])`
  - `Requirements(min_level: Literal["state","ac"]="state")`
  - `CardConfig(id: str, family: Family, section: str, title: str, scenarios: list[str]=[], cuts: list[list[str]]=[[]], filters: list[FilterSpec]=[], comparison: ComparisonConfig=ComparisonConfig(), caste_clubbing: bool=False, requires: Requirements=Requirements())`
  - `SEAT_DIMENSIONS = frozenset({"ac_num","pc_num","district"})`
  - `scenario_kind(scenario_id: str) -> Literal["party","opinion"]`: via `matbodh_dash.catalog.default_scenarios()`; domain `party` is party, `ordinal` and `boolean` are opinion, unknown raises `ValueError`.
  - `comparison_kind(target_kind: str, reference_kind: str) -> Literal["difference","shakti"]`
  - `load_cards(path: Path) -> dict[str, CardConfig]` (top-level `cards:` list, duplicate id raises).
- `CardConfig.scenarios` is derived from the endpoints when `mode == "compare"` (target then reference, de-duplicated).

- [ ] **Step 1: Write failing tests** (names; each asserts a `ValueError`/`ValidationError` message fragment unless stated):
  - `test_distribution_rejects_opinion_scenario` ("scenario kind"), `test_opinion_rejects_party_scenario`
  - `test_gender_differential_rejects_compare_mode`, `test_gender_differential_rejects_gender_in_cuts`, `test_gender_differential_allows_trend_and_standalone` (no error)
  - `test_duplicate_cuts_rejected` (`[["category","caste"],["caste","category"]]`)
  - `test_filter_needs_values`, `test_filter_one_entry_per_field`
  - `test_caste_clubbing_needs_caste_in_a_cut`
  - `test_standalone_forbids_endpoints`, `test_compare_needs_both_endpoints`, `test_trend_needs_exactly_one_scenario`
  - `test_compare_derives_scenarios_from_endpoints` (`config.scenarios == ["vs_voting_intention","ls_past"]`)
  - `test_comparison_kind_matrix`: party/party and opinion/opinion are `difference`; party target with opinion reference is `shakti`; opinion target with party reference raises
  - `test_delta_measures_validated`: party compare allows only `["support_share"]`; opinion compare allows a subset of `net_score, positive_share, negative_share`, default `["net_score"]`; shakti ignores it
  - `test_load_cards_rejects_duplicate_ids_and_unknown_keys`, `test_seed_cards_load` (loads `config/cards/cards.yaml`)
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/cards/test_config.py -q`. Expected: FAIL (import error).
- [ ] **Step 3: Implement** `config.py` with a `model_validator(mode="after")` that applies the rules of spec §5. Put three seed cards in `config/cards/cards.yaml`: `distribution.support_by_caste` (the §5 example in `standalone` mode), `opinion.leaders` (`standalone`, scenarios `pm_satisfaction, cm_satisfaction`, cuts `[[]]`), `gender.gap_by_zone` (`gender_differential`, scenario `vs_voting_intention`, cuts `[[], [party_zone]]`).
- [ ] **Step 4: Run** the test file. Expected: PASS.
- [ ] **Step 5: Commit** `git add matbodh_dashboard/cards config/cards tests/cards/test_config.py` then `git commit -m "feat(cards): add CardConfig models and validation"`.

---

### Task 3: Payload models and family specs

**Files:**
- Create: `matbodh_dashboard/cards/payload.py`, `matbodh_dashboard/cards/families/{__init__,distribution,opinion,gender_differential}.py`
- Test: `tests/cards/test_families.py`

**Interfaces:**
- Produces in `payload.py` (pydantic, `extra="forbid"`): `LensDef(id, label, unit: Literal["percentage","percentage_points"], has_delta: bool=False)`; `Capabilities(modes: list[Literal["standalone","compare","trend"]], transpose=True, sort=True, details=True)`; `FamilyMeta(family, lenses: list[LensDef], default_lens: str, capabilities)`; `Column(key, label, scenario, kind: Literal["party","option","scale"], colour: str|None, lenses: list[str]|None=None)`; `RowDef(key, labels: dict[str,str|None], subtotal: list[str])`; `CellValue(row, column, round: str|None, lens, value: float|None, status: str)`; `DeltaValue(row, column, lens, target: str, reference: str, value, reference_value, relative_change_pct: float|None, status: str)`; `BaseDetail(row, column, round: str|None, fields: dict[str, Any])`; `Cut(id, dimensions: list[str], rows, cells, deltas, bases)`; `GridPayload(family, card_id, mode, state, rounds: dict, meta, columns, cuts, unavailable: list[dict], not_asked: list[dict], coverage: list[dict], provenance: dict, hidden_count: int, rules_version, engine_version, metadata_revision: int, alliance_epoch: int)`. Status vocabulary: `available, null_value, missing_target, missing_reference, not_covered, not_asked, no_eligible_result`.
- Produces in `families/__init__.py`: `LensSource(array: Literal["rows","scores","gender_differentials"], field: str, domain: str|None=None, delta_measure: str|None=None, delta_field: Literal["percentage_point_difference","size_of_impact_pp"]|None=None)`; `FamilySpec` (frozen dataclass: `name`, `scenario_kind: Literal["party","opinion"]`, `gender_differential: bool`, `lenses: tuple[LensDef,...]`, `lens_sources: Mapping[str, LensSource]`, `default_lens: str`, `capabilities: Capabilities`); `FAMILIES: dict[str, FamilySpec]`; `get_family(name) -> FamilySpec` (raises `KeyError`); `family_meta(spec) -> FamilyMeta` (all lenses, before data filtering).
- Lens tables (ids are the engine field names; labels from the engine guides):
  - **distribution** (`rows`, domain `party`): `support_share` (default, delta `support_share`/`percentage_point_difference`), `composition_share`, `contribution_share`, `scenario_composition_share`, `joint_share` (all `percentage`, no delta), `size_of_impact_pp` (`percentage_points`, delta `support_share`/`size_of_impact_pp`).
  - **opinion** (`scores`): `net_score` (default; delta `net_score`/`percentage_point_difference`), `positive_share`, `negative_share` (delta by their measures), `net_size_of_impact_pp`, `positive_size_of_impact_pp`, `negative_size_of_impact_pp` (delta field `size_of_impact_pp` on the matching measure); plus `option_support_share` from `rows` (domain `ordinal` or `boolean`, field `support_share`, columns scoped to this lens).
  - **gender_differential** (`gender_differentials`): `gender_differential_pp` (default, `percentage_points`), `female_support_share`, `male_support_share` (`percentage`), `size_of_impact_pp` (`percentage_points`); capabilities modes `["standalone","trend"]`; the other two families have all three modes.

- [ ] **Step 1: Write failing tests:** `test_lens_ids_unique_per_family`; `test_default_lens_is_a_lens`; `test_gender_differential_has_no_compare_mode`; `test_delta_lenses_name_a_delta_source` (every `has_delta` lens has `delta_measure` and `delta_field`; no delta lens in gender_differential); `test_get_family_unknown_raises`; `test_payload_rejects_unknown_fields` (a `CellValue` with an extra field raises).
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/cards/test_families.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules (data only; no logic beyond the registry).
- [ ] **Step 4: Run** the test file. Expected: PASS.
- [ ] **Step 5: Commit** `git add matbodh_dashboard/cards tests/cards/test_families.py` then `git commit -m "feat(cards): add payload models and family specs"`.

---

### Task 4: Field coverage harness

**Files:**
- Create: `matbodh_dashboard/cards/field_map.py`, `matbodh_dashboard/cards/field_maps/{distribution,opinion,gender_differential}.yaml`
- Test: `tests/cards/test_field_coverage.py`

**Interfaces:**
- Consumes: `FAMILIES`, `FAMILY_SAMPLES`, `load_sample`.
- Produces: `ROLES = frozenset({"lens","row","column","delta","detail","status","provenance","ignored"})`; `load_field_map(family: str) -> dict[str, dict[str, str]]` (array name to key to role); `unmapped_keys(family: str, result: dict) -> list[str]` returning `"<array>.<key>"` for every key not mapped. Each family map lists the arrays it owns: distribution owns `rows` (only items with `outcome_domain == "party"`), `comparisons` (party measure `support_share`), `populations`; opinion owns `scores`, `rows` (domain `ordinal` or `boolean`), `comparisons` (score measures), `populations`; gender_differential owns `gender_differentials`, `populations`. Top-level `context_status` (role `status`) and `contract` (role `provenance`, opaque) are mapped for all. An `ignored` entry must carry a non-empty `reason`; load fails otherwise.
- YAML is filled from spec §8's key lists, using the role table there (for example `support_share: lens`, `weighted_denominator: detail`, `coverage_status: status`, `party_id: column`, `dimensions: row`, `percentage_point_difference: delta`, `state: provenance`, `group_mask: ignored` with reason "internal grain marker; the cut id and subtotal flags carry the same information").

- [ ] **Step 1: Write failing tests:** `test_every_sample_key_is_mapped` parametrised over every family and sample (`unmapped_keys == []`); `test_unknown_key_is_reported` (add `brand_new` to a row, expect `["rows.brand_new"]`); `test_ignored_needs_reason`; `test_every_lens_field_is_mapped_as_lens` (each `LensSource.field` has role `lens` in its array's map); `test_every_role_is_known`.
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/cards/test_field_coverage.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** `field_map.py` and the three YAML files. Where a sample shows a key not in spec §8, map it with the closest role and add it to the spec §8 list in the same commit.
- [ ] **Step 4: Run** the test file. Expected: PASS (zero unmapped keys across all samples).
- [ ] **Step 5: Commit** `git add matbodh_dashboard/cards tests/cards/test_field_coverage.py docs/specs/2026-11-10-card-foundation-and-grid-family-design.md` then `git commit -m "feat(cards): add per-family field coverage maps and checker"`.

---

### Task 5: Request builder accepts filters, caste clubbing and an explicit reference

**Files:**
- Modify: `matbodh_dashboard/compiler/requests.py:43-102`
- Test: `tests/compiler/test_requests.py`

**Interfaces:**
- Produces: `build_request(..., filters: Sequence[dict] = (), caste_clubbing: dict | None = None, reference_observation: str | None = None) -> dict`. A passed `reference_observation` wins; otherwise the existing rule (latest round when `coverage_mode == "common"`) applies. `filters` entries are `{"field","operator","values"}`; `caste_clubbing` is `{"threshold_pct", "reference_observation"}`. `comparison(...)` gains `kind: str = "difference"` and the returned dict carries that `kind`.

- [ ] **Step 1: Write failing tests:** `test_build_request_passes_filters_and_caste_clubbing`; `test_explicit_reference_observation_wins`; `test_default_behaviour_unchanged` (existing calls give identical output); `test_comparison_kind_is_emitted` (`comparison(..., kind="shakti")["kind"] == "shakti"`).
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/compiler/test_requests.py -q`. Expected: FAIL (new tests), existing pass.
- [ ] **Step 3: Implement** the optional parameters; keep every existing default.
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit** `git add matbodh_dashboard/compiler/requests.py tests/compiler/test_requests.py` then `git commit -m "feat(compiler): let build_request carry filters, caste clubbing and reference"`.

---

### Task 6: `compile_card`

**Files:**
- Create: `matbodh_dashboard/cards/compile.py`
- Test: `tests/cards/test_compile.py`

**Interfaces:**
- Consumes: `CardConfig`, `get_family`, `build_request`, `view_config`, `comparison`, `resolve_rounds`, `resolve_anchor`, `choose_coverage`, `field_available`, `template_blockers`, `RunPlan`, `EngineJob`.
- Produces: `compile_card(config: CardConfig, ctx: StateContext, catalogue: Catalogue, preset: MethodPreset) -> RunPlan` with one `EngineJob(key="grid", kind="analysis", part="grid", config=<view_config>)`.
- Rules (spec §6.2): used rounds by mode (`standalone`: anchor; `compare`: the endpoint rounds, where `anchor` and `compare` resolve from the context; `trend`: all context rounds, which must number 2 to 4). In `trend`, a round whose dataset lacks the scenario is dropped from the request and recorded in `not_asked` as `("grid", (base_name,))`; fewer than 2 remaining rounds is `unavailable`. In `standalone` and `compare`, a missing scenario or field in a used round is `unavailable` with a message naming the field and the round base names. `compare` needs `ctx.compare_round` when an endpoint says `compare` (else `unavailable`: "choose a comparison round"). Comparisons: `compare` yields one comparison per `delta_measures` entry (or one `shakti` comparison); `trend` and `standalone` yield none. `coverage_mode`: `compare` only, `choose_coverage(rounds, uses_seat_ids=False, geographic=<any cut or filter field in SEAT_DIMENSIONS>, version_mode=ctx.version_mode)`; `standalone` and `trend` use `independent`. Caste clubbing: `{"threshold_pct": preset.caste_threshold_pct, "reference_observation": <reference round obs id in compare, else anchor obs id>}`. Level blockers via `template_blockers(config.requires.min_level, <all cut and filter fields>, ctx.level)`. `gender_differential` families set `gender=True` and never send a `gender` dimension.

- [ ] **Step 1: Write failing tests** (reuse `_catalogue`/`_ctx` patterns and fixtures from `tests/compiler/test_plan.py`; rounds `R1,R2,R3`, anchor latest):
  - `test_standalone_uses_anchor_round_only` (observations `["o3"]`, `comparisons == []`, `coverage_mode == "independent"`, `grouping_sets == config.cuts`, preset weights present)
  - `test_compare_inter_round` (`comparisons[0]` target `["o3","vs_voting_intention"]`, reference `["o1","vs_voting_intention"]`, `kind == "difference"`, observations `o1,o3`)
  - `test_compare_intra_round` (same round, scenarios `vs_voting_intention` vs `ls_past`, one observation, `request.scenarios` has both)
  - `test_compare_party_vs_opinion_is_shakti`, `test_opinion_compare_emits_one_comparison_per_delta_measure`
  - `test_seat_level_compare_chooses_common_coverage` (cut `[ac_num]`, rounds with different seat sets)
  - `test_trend_drops_round_missing_scenario` (not_asked contains that base name, `unavailable == ()`), `test_trend_needs_two_asked_rounds`, `test_trend_rejects_more_than_four_rounds`
  - `test_missing_field_is_unavailable_with_names`, `test_compare_without_compare_round_is_unavailable`
  - `test_geographic_cut_blocked_at_pc_level`
  - `test_caste_clubbing_reference_is_anchor_in_standalone_and_reference_in_compare`
  - `test_gender_differential_request_has_gender_block_and_no_gender_cut`
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/cards/test_compile.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** `compile_card`; one helper per rule above, no engine arithmetic.
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit** `git add matbodh_dashboard/cards/compile.py tests/cards/test_compile.py` then `git commit -m "feat(cards): compile CardConfig to an engine job"`.

---

### Task 7: `translate_grid`

**Files:**
- Create: `matbodh_dashboard/cards/translate.py`
- Modify: `matbodh_dashboard/compiler/plan.py` (move `_rounds` from `runner/service.py:502` here as `rounds_block(plan: RunPlan, anchor: str, compare: str | None) -> dict`)
- Test: `tests/cards/test_translate.py`; helper `context_for(...)` in `tests/cards/samples.py`

**Interfaces:**
- Produces: `TranslateContext` (frozen dataclass: `card_id, state, rounds: dict, round_order: list[str], labels: dict[str,str], anchor: str, compare: str | None, unavailable: list[dict], not_asked: list[dict], rules: RuleSet, rules_version, engine_version: str, metadata_revision: int, alliance_epoch: int`); `row_key(dims: Sequence[tuple[str, str | None, bool]]) -> str` (non-subtotal dims as `dim=value` joined by `|`, genuine NULL as `dim=~null`, empty as `overall`); `translate_grid(config: CardConfig, spec: FamilySpec, result: dict, tc: TranslateContext) -> GridPayload`.
- Behaviour (spec §6.3, §7, §8): one `Cut` per engine `grouping_set_id` (`g<N>` maps to `config.cuts[N]`); rows from owned arrays plus population-only groups (empty cells); columns from `party_id` or `option_id` or scale and scenario, coloured and ordered through `tc.rules` (`order`, `label`, `colour`, `hidden_count`, field names `party` and `scenario`); one `CellValue` per row, column, round and lens whose source array is present, value copied unchanged, `status` from `coverage_status` or `null_value` when the value is null; `meta.lenses` lists only lenses with at least one non-null value; deltas only in `compare` mode, taken from `comparisons` rows (`delta_field` of the lens's `delta_measure`, `reference_value`, `relative_change_pct`, `status` from `impact_status`); `bases` hold the `detail`-role fields of the field map; `not_asked` entries produce `not_asked` status cells for those rounds in `trend`; `provenance` is `contract` plus `resolved_datasets`.

- [ ] **Step 1: Write failing tests** (sample-driven tests derive expectations from the sample itself):
  - `test_values_are_copied_verbatim` for every family and sample: every payload cell value equals the source field value exactly, and every non-null payload number exists in the source
  - `test_null_value_is_not_zero` (mini result with `support_share: None`: `cell.value is None`, `status == "null_value"`)
  - `test_subtotal_and_genuine_null_dimension_are_distinct_rows`
  - `test_population_only_group_becomes_an_empty_row`
  - `test_lens_without_data_is_not_listed`
  - `test_compare_deltas_come_from_comparison_rows` (delta equals `percentage_point_difference`; impact lens delta equals `size_of_impact_pp`; `reference_value` and `relative_change_pct` carried)
  - `test_missing_comparison_status_keeps_value_and_marks_delta` (status `missing_reference`, delta value `None`)
  - `test_no_deltas_in_trend_or_standalone`
  - `test_trend_has_one_cell_per_round_and_not_asked_round_is_marked`
  - `test_lens_units_match_engine_units` (sample rows' `unit`/`measure_units` agree with `LensDef.unit`)
  - `test_cut_ids_and_dimensions_follow_config_cuts`
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/cards/test_translate.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** `translate_grid` as pure functions over the engine dict; do not import `NormalRow`.
- [ ] **Step 4: Run** the file plus `tests/runner` (keep a `_rounds` re-export in `service.py` until Task 8 so imports hold). Expected: PASS.
- [ ] **Step 5: Commit** `git add matbodh_dashboard/cards/translate.py matbodh_dashboard/compiler/plan.py matbodh_dashboard/runner/service.py tests/cards` then `git commit -m "feat(cards): translate engine results to a grid payload"`.

---

### Task 8: Service, API and bootstrap wiring

**Files:**
- Modify: `matbodh_dashboard/runner/service.py`, `matbodh_dashboard/bootstrap.py`, `matbodh_dashboard/api/app.py`
- Test: `tests/runner/test_service.py`, `tests/api/test_app.py`, `tests/test_bootstrap.py`

**Interfaces:**
- Consumes: `compile_card`, `translate_grid`, `TranslateContext`, `FAMILIES`, `load_cards`.
- Produces: `CardRunService(catalogue, preset, cards: dict[str, CardConfig], rules, cache, queue, engine_version)` (parameter renamed from `templates`); `plan()` calls `compile_card`; `_assemble` builds a `TranslateContext` and returns `translate_grid(...).model_dump()`; `GET /cards` returns `[{**config.model_dump(), "meta": family_meta(...).model_dump()}]` (optional `?section=`); `/templates` is removed; `/cards/plan` and `/cards/run` keep their request and response envelopes; `bootstrap.load_card_config(config_dir) -> tuple[MethodPreset, dict[str, CardConfig], RuleSet]` reads `config/cards/cards.yaml`.

- [ ] **Step 1: Write failing tests** using the existing fake queue and cache of `tests/runner/test_service.py` (a queue stub returning a sample result): `test_grid_card_runs_to_done_and_returns_payload` (status `done`, `result["family"] == "distribution"`, `result["cuts"]`); `test_failed_job_reports_error_and_no_payload`; `test_unknown_card_raises_keyerror`; API: `test_cards_endpoint_lists_seed_cards_with_meta`, `test_plan_and_run_envelopes_unchanged`, `test_compare_mode_without_compare_round_returns_unavailable`; bootstrap: `test_load_card_config_reads_cards_yaml`.
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/runner tests/api tests/test_bootstrap.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the wiring. Remove the scoreboard, opinion and zone branches of `_assemble`, `_grid`, `_parties`, `_rows`, `_one_bench_vote_level`, the contender binding, and the old `plan_card` import. Keep queue, cache, fingerprint, retry and logging code. Delete the `_rounds` re-export.
- [ ] **Step 4: Run** `.venv/Scripts/python.exe -m pytest tests/cards tests/runner tests/api tests/test_bootstrap.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `git add matbodh_dashboard/runner/service.py matbodh_dashboard/bootstrap.py matbodh_dashboard/api/app.py tests/runner tests/api tests/test_bootstrap.py` then `git commit -m "feat(api): run cards through the family compiler and translator"`.

---

### Task 9: Backend cleanup (State Pulse and dead code)

**Files:**
- Delete: `matbodh_dashboard/templates.py`, `config/templates/pulse.yaml`, `matbodh_dashboard/normalise/cells.py`, `tests/normalise/test_cells.py`, `tests/test_presets_templates.py` (move the preset assertions into `tests/test_presets.py`), `scripts/smoke_state_pulse.py`
- Modify: `matbodh_dashboard/compiler/plan.py` (remove `_Planner`, `plan_card`, `bind_contenders`; keep `EngineJob`, `RunPlan`, `rounds_block`, `field_available`, `_by_base_name`, `_endpoint`, `_benchmark_job`), `matbodh_dashboard/normalise/__init__.py`, `tests/compiler/test_plan.py`, `tests/compiler/test_engine_configs.py`, `tests/api/fixture_export.py`, `tests/api/test_fixture_export.py`, `tests/test_smoke_script.py`
- Test: `tests/test_presets.py`; full backend suite

**Interfaces:**
- Produces: `scripts/smoke_card.py --card <id> --state <state> --rounds <names...>` (same wiring as the old smoke script; not run here, needs product-owner approval).

- [ ] **Step 1: Write failing tests** `tests/test_presets.py::test_uttar_pradesh_preset_loads` (carried over from the deleted test) and `tests/test_smoke_script.py::test_smoke_card_parses_card_id`.
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/test_presets.py tests/test_smoke_script.py -q`. Expected: FAIL.
- [ ] **Step 3:** Delete the files above; rewrite the pulse-specific plan and engine-config tests to use `cards.yaml` cards (the generic tests that exercise `build_request`, rounds and coverage stay); implement `scripts/smoke_card.py` from the old script.
- [ ] **Step 4: Run** `.venv/Scripts/python.exe -m pytest -q`. Expected: whole backend suite PASS, no skips attributable to this work.
- [ ] **Step 5: Commit** with explicit paths of every deleted and modified file (`git add -u matbodh_dashboard config tests scripts` stages only tracked changes in those directories; confirm with `git status` that none of the protected uncommitted files are staged) then `git commit -m "refactor(backend): remove State Pulse and the scoreboard pipeline"`.

---

### Task 10: Frontend payload types and `payloadToGrid`

**Files:**
- Modify: `web/src/api/types.ts`, `web/src/table/grid.ts` (add fields to `CellGrid`), `web/src/cells/format.ts` (flags)
- Create: `web/src/cards/grid/payloadToGrid.ts`, `scripts/export_card_fixtures.py`, `web/src/test/fixtures/cards/{distribution,opinion,gender_differential}_{standalone,compare,trend}.json` (generated; no gender differential compare file)
- Test: `web/src/cards/grid/payloadToGrid.test.ts`, `tests/cards/test_fixture_export.py`

**Interfaces:**
- Produces: TypeScript mirrors of the Task 3 payload models (`GridPayload`, `FamilyMeta`, `LensDef`, `Column`, `Cut`, `RowDef`, `CellValue`, `DeltaValue`, `BaseDetail`, `CardInfo = CardConfig & { meta: FamilyMeta }`); `export interface GridView { lens: string; cut: string }`; `export function payloadToGrid(p: GridPayload, view: GridView): CellGrid`; `CellGrid` gains `mode: "standalone" | "compare" | "trend"`, `roundLabels: string[]`, `referenceLabel?: string`. Cell mapping: `standalone`: value from the single round; `compare`: `Cell.value` is the target value, `Cell.delta` the engine delta, `Cell.secondary` the reference label (the reference value appears in the details popover from `bases`); `trend`: `Cell.trend` is the per-round values in `roundLabels` order and `Cell.value` the anchor round's value. Units: `percentage` maps to `"pct"`, `percentage_points` to `"pp"`. Null values keep `value: null` with the status added to `Cell.flags` (`not_asked`, `missing_target`, `missing_reference`, `null_value`, each with an entry in `FLAG_INFO` giving its reason).

- [ ] **Step 1: Write failing tests** in `payloadToGrid.test.ts` using the generated fixtures: `switches value and unit with the lens`; `a lens without data is absent from meta and falls back to the default`; `compare cell carries engine delta and reference label`; `trend cell carries one value per round in order`; `trend not_asked round is null with a not_asked flag`; `null value is never 0` (asserts `cell.value === null` and a flag, and the formatted text is `—`); `subtotal row and null-dimension row have distinct keys`; `population-only row has null cells`; `unknown cut id throws a clear error`; `missing_reference delta is null but value is kept`. In `tests/cards/test_fixture_export.py`: `test_export_writes_one_fixture_per_mode_and_family`.
- [ ] **Step 2: Run** `cd web && npx vitest run src/cards/grid` and `.venv/Scripts/python.exe -m pytest tests/cards/test_fixture_export.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** `scripts/export_card_fixtures.py` (builds a `TranslateContext` from each sample with `context_for`, calls `translate_grid`, writes JSON), run it once to create the fixtures, then implement `payloadToGrid` and the type and flag additions. Old `CardResult` types stay until Task 13.
- [ ] **Step 4: Run** both test commands, then `cd web && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add scripts/export_card_fixtures.py tests/cards/test_fixture_export.py web/src/api/types.ts web/src/table/grid.ts web/src/cells/format.ts web/src/cards/grid web/src/test/fixtures/cards` then `git commit -m "feat(web): convert grid payloads to cell grids"`.

---

### Task 11: View state, `PopoverChip` and `ControlStrip`

**Files:**
- Create: `web/src/cards/view.ts`, `web/src/cards/PopoverChip.tsx`, `web/src/cards/ControlStrip.tsx`
- Test: `web/src/cards/ControlStrip.test.tsx`

**Interfaces:**
- Produces: `interface FamilyView { lens: string; cut: string; preset: ShowPreset; density: Density; transposed: boolean; format: FormatRule["kind"]; within: "column" | "row" | "table"; sort: SortSpec | null; search: string; hidden: string[]; showDetails: boolean }`; `initialView(payload: GridPayload): FamilyView` (default lens from `meta.default_lens`, first cut, `format: "diverging"` in compare mode else `"none"`); `PopoverChip({ label, selected, children })` (moved from `CardToolbar.tsx`); `ControlStrip({ payload, view, onView, onMethod, onExport, canExport, onRefresh })` rendering only the controls the payload's `meta.capabilities` allows: cut tabs (when more than one cut), lens chip (when more than one lens has data), details toggle, sort, transpose, format with scope, density and cell parts, search and hidden-party chip, and the `⋯` menu (method, CSV, refresh). Chips wrap and collapse extras into a `+n` menu.

- [ ] **Step 1: Write failing tests:** `shows only lenses present in meta`; `hides the lens chip when only one lens has data`; `gender differential strip has no compare or delta sort controls`; `changing lens calls onView with only {lens}`; `transpose chip is absent when capabilities.transpose is false`; `strip wraps and shows +n when narrow` (render in a 320px container, assert the overflow trigger); `every popover chip is keyboard operable` (Enter opens, Escape closes); `view changes never call fetch` (spy on `globalThis.fetch`, change every control, assert zero calls).
- [ ] **Step 2: Run** `cd web && npx vitest run src/cards/ControlStrip.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the three files, reusing `chipStyle`, `SegmentedControl` patterns, `formatRules`, `parts` and the sort options logic from `CardToolbar.tsx`.
- [ ] **Step 4: Run** the test and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add web/src/cards/view.ts web/src/cards/PopoverChip.tsx web/src/cards/ControlStrip.tsx web/src/cards/ControlStrip.test.tsx` then `git commit -m "feat(web): add card view state and the display control strip"`.

---

### Task 12: `GridBody`, `PipeCell` and compare/trend rendering

**Files:**
- Create: `web/src/cells/PipeCell.tsx`, `web/src/cards/families/_grid/GridBody.tsx`
- Modify: `web/src/table/CompositeTable.tsx` (render `PipeCell` when `grid.mode === "trend"`; show `roundLabels` as the header sub-label; compare cells use the existing delta part with `Cell.secondary` as the `vs …` label; rows virtualised above 100; sticky header and first column with scroll padding)
- Test: `web/src/cells/PipeCell.test.tsx`, `web/src/cards/families/_grid/GridBody.test.tsx`

**Interfaces:**
- Produces: `PipeCell({ values: (number | null)[], unit: Unit, labels: string[], flags: string[][] })` (segments separated by thin rules, `—` with the reason in a title for null segments); `GridBody({ payload, view, rules?, onView })` which applies `payloadToGrid`, `applyPresentationRules` (props `order` and `colors` override), hidden parties, search, `sortRows`, `transpose`, conditional formatting, and `CompositeTable`. A trend cell never shows a delta; a compare cell never shows pipes.

- [ ] **Step 1: Write failing tests:** `PipeCell renders one segment per round with separators`; `PipeCell shows an em dash and reason for null segments, never 0`; `trend mode shows no delta`; `compare mode shows value and delta beside it with the reference label`; `missing_reference shows the value and a dash delta with the reason` (Review Focus 5); `rows above 100 are virtualised` (rendered row count is less than the data row count); `transpose keeps the lens and unit`; `hidden party column is not rendered`; `order and colors props override presentation rules, unlisted items before pinned ones`.
- [ ] **Step 2: Run** `cd web && npx vitest run src/cells src/cards/families src/table`. Expected: FAIL.
- [ ] **Step 3: Implement** the components; reuse `CompositeCell`, `Delta`, `formatValue`, `formatTrendPipes`, `cellStyle`, `legend`.
- [ ] **Step 4: Run** the same command plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add web/src/cells/PipeCell.tsx web/src/cells/PipeCell.test.tsx web/src/cards/families web/src/table/CompositeTable.tsx` then `git commit -m "feat(web): render compare and trend grids"`.

---

### Task 13: `CardShell`, family registry, cards page, and frontend cleanup

**Files:**
- Create: `web/src/cards/CardShell.tsx`, `web/src/cards/families/index.ts`, `web/src/cards/families/{distribution,opinion,gender_differential}/index.ts`, `web/src/pages/CardsPage.tsx`
- Modify: `web/src/api/queries.ts` (`useTemplates` becomes `useCards(section?: string)` calling `GET /cards`), `web/src/api/client.ts`, `web/src/api/types.ts` (remove `CardResult`, `ScoreboardRow`, `OpinionRow`, `Ranked*`, `Transition*`, `Battleground*`, `Template`), `web/src/App.tsx` (route `/` renders `CardsPage`), `web/src/cards/MethodDrawer.tsx` (reads `payload.provenance`), `web/src/cards/coverage.ts`, `web/src/cards/CardFooter.tsx`
- Delete: `web/src/pages/{StatePulse,CoverageStrip}.tsx` and tests, `web/src/cards/{Card.tsx,Card.test.tsx,CardToolbar.tsx,CardToolbar.test.tsx}`, `web/src/cards/body/*`, `web/src/test/fixtures/{templates_pulse,run_*_done,run_scoreboard_*}.json`; rewrite `web/src/shell/AppShell.test.tsx` to use a card list fixture instead of the pulse fixtures
- Test: `web/src/cards/CardShell.test.tsx`, `web/src/pages/CardsPage.test.tsx`, `web/src/App.test.tsx`

**Interfaces:**
- Produces: `CardShell({ info: CardInfo, ctx: StateContext, presentationRules?: PresentationRules, order?, colors? })` (runs `useCardPlan` and `useCardRun`, shows a header with a series-qualified subtitle, `ControlStrip`, the family body from the `FAMILY_BODIES: Record<Family, ComponentType<...>>` registry in `families/index.ts`, and a footer with coverage and not-asked notes, the format legend and "How this was calculated"); loading, `unavailable`, partial-failure and error states reuse the existing messages. `CardsPage` lists every card from `useCards()` for the current context.

- [ ] **Step 1: Write failing tests:** `renders each family from its fixture payload` (three families); `unavailable card shows the engine reason and no grid`; `a failed run shows the error with a refresh button`; `changing lens, cut, transpose and format makes no extra requests` (count `fetch` calls after the first run); `footer shows per-round coverage and not-asked notes`; `subtitle uses series-qualified round names, bare labels only as sub-headers`; `CardsPage renders one CardShell per card`; `App renders the cards page at /`.
- [ ] **Step 2: Run** `cd web && npx vitest run src/cards src/pages src/App.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the shell, registry, page and query changes, then delete the listed files and remove the old types. `InvestigationDrawer.tsx`, `MethodDrawer.tsx` and `CardFilterBar.tsx` stay (leave the drawer and filter bar unused for now rather than delete them).
- [ ] **Step 4: Run** `cd web && npm test` and `npm run typecheck` and `npm run build`. Expected: all PASS with no references to removed types.
- [ ] **Step 5: Commit** `git add -u web/src` plus the new files under `web/src/cards` and `web/src/pages`; check `git status` shows `ContextBar.tsx`, `ContextBar.test.tsx`, `ContextDialog.*` still unstaged; `git commit -m "refactor(web): replace Card and State Pulse with CardShell and the cards page"`.

---

### Task 14: End-to-end journey against fixture payloads

**Files:**
- Create: `web/e2e/cards.spec.ts`
- Modify/Delete: `web/e2e/universal-card.spec.ts` (replace), `web/e2e/state-pulse.spec.ts` (delete; this file carries uncommitted edits that are State Pulse-only and are dropped per the product owner)
- Test: `web/e2e/cards.spec.ts`

**Interfaces:**
- Consumes: the fixtures from Task 10 served by Playwright route mocks for `GET /cards`, `POST /cards/plan`, `POST /cards/run`, `GET /runs/:id`.

- [ ] **Step 1: Write the failing journey:** load `/`; three cards visible; in the distribution card switch lens to impact and assert the unit and values change with zero extra API calls; transpose and assert rows and columns swap while the lens persists; apply the diverging format and assert the legend; in a trend fixture card assert pipes and no delta; in a compare fixture card assert value plus delta and the reference label; switch the cut; open the method drawer; keyboard: Tab through the strip, open a chip with Enter, close with Escape and focus returns to the chip.
- [ ] **Step 2: Run** `cd web && npm run e2e`. Expected: FAIL.
- [ ] **Step 3:** Implement the route mocks and any missing `data-testid` or accessible names found by the journey (no behaviour change).
- [ ] **Step 4: Run** `cd web && npm run e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `git add web/e2e` (including the deletions) then `git commit -m "test(e2e): add the cards journey against fixture payloads"`.

---

### Task 15: Payload size measurement

**Files:**
- Create: `scripts/measure_payload.py`
- Test: `tests/cards/test_measure_payload.py`

**Interfaces:**
- Produces: `measure(sample_path: Path, family: str) -> dict` returning `{"rows": int, "json_bytes": int, "gzip_bytes": int}`; the script prints it for `result_ac_1.json` and `result_gd_complex.json` read from `../MatBodh-Dash/sample-output` (or `--sample-dir`), which are not copied into this repository.

- [ ] **Step 1: Write the failing test** on a small fixture: `measure` returns positive byte counts and `gzip_bytes < json_bytes`.
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/cards/test_measure_payload.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the function and the CLI. Run the script once on the two large samples and record the numbers in the Task 16 docs change. If either exceeds 2 MB gzipped, stop and report: the spec (§6.3) requires choosing a compact encoding before shipping, and that is a follow-up decision for the product owner.
- [ ] **Step 4: Run** the unit test. Expected: PASS.
- [ ] **Step 5: Commit** `git add scripts/measure_payload.py tests/cards/test_measure_payload.py` then `git commit -m "feat(cards): add payload size measurement script"`.

---

### Task 16: Documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/specs/2026-11-10-universal-card-component-design.md` and `docs/plans/2026-11-10-universal-card-component.md` (add one line at the top: "Superseded by ..."), `docs/specs/2026-11-10-card-foundation-and-grid-family-design.md` (record measured payload sizes and the resolved open items 13.1 to 13.5 if confirmed)
- Test: none (docs); verify with `git grep -n "state_pulse\|StatePulse\|pulse.yaml"` returning no matches outside historical docs.

- [ ] **Step 1:** Replace State Pulse mentions in `README.md` and `CLAUDE.md` (overview, commands, project structure) with the card foundation, `config/cards/`, `matbodh_dashboard/cards/`, the new smoke script, and a pointer to the spec and this plan.
- [ ] **Step 2:** Add the "Superseded by" lines to the two old docs; add the measured payload sizes and the status of the open items to the spec.
- [ ] **Step 3: Run** the `git grep` command above. Expected: no matches in live docs or code.
- [ ] **Step 4: Run** `.venv/Scripts/python.exe -m pytest -q`, `cd web && npm test && npm run typecheck && npm run build && npm run e2e`. Expected: all PASS. State what was not run: the live smoke check (needs product-owner approval).
- [ ] **Step 5: Commit** `git add README.md docs` then `git commit -m "docs: document the card foundation and supersede State Pulse docs"`; leave `CLAUDE.md` unstaged while it is untracked, and add it only if the product owner wants it tracked.

---

## Self-Review

**Spec coverage:** §1-2 scope and decomposition: Tasks 1-16. §3 principles: Global Constraints, enforced in Tasks 7, 10, 11, 12. §4 ownership and §5 `CardConfig`: Task 2. §6.1-6.2 `FamilySpec` and compilation: Tasks 3, 5, 6. §6.3 payload: Tasks 3, 7, 10, 15. §7 lenses: Task 3 tables, Task 7. §8 field coverage: Task 4. §9 frontend: Tasks 10-13. §10 API: Task 8. §11 cleanup: Tasks 9 and 13. §12 testing: each task plus Task 14. §13 open items: Task 4 (Yes/No domain), Task 6 (`district` seat-level), Task 15 (payload size), Task 16 (record outcomes); the dimension-order question (13.2) is not exercised by any task and is only recorded in Task 16. §14 acceptance: Tasks 7, 9, 12, 13, 14 and the final run in Task 16. No spec requirement lacks a task except 13.2 (documentation only).

**Type consistency:** `FamilySpec`, `LensSource`, `LensDef`, `GridPayload`, `TranslateContext`, `FamilyView`, `GridView`, `CellGrid.mode` and the job key `"grid"` use the same names in every task that mentions them.

**Proportion:** Tasks give signatures, test names and the spec's exact values; bodies are left to the implementer.
