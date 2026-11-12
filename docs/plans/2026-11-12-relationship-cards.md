# Relationship Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `relationship` card family: a Flow summary table and a major-party Matrix table over one engine relationship run, with two starter cards for Uttar Pradesh.

**Architecture:** Follow the benchmark family end to end. `CardConfig` gains a `relationship` block; a compiler turns it into one `EngineJob("relationship", ...)` whose config the existing `NamedSurveyRuntime` path already executes; a translator copies engine values into a `RelationshipPayload`; the runner assembles it like the benchmark; a React card shows two tables. The engine owns every number; Python and TypeScript copy, filter and lay out.

**Tech Stack:** Python 3.12 (pydantic, pytest, fakeredis), FastAPI, React + TypeScript + Vite + Mantine, Vitest.

**Spec:** `docs/specs/2026-11-12-relationship-cards-design.md` (read it first; section numbers below refer to it). Engine docs: `MatBodh-Dash/docs/guides/scenario-relationships.md`, `docs/usage.md` (Scenario relationships), samples `MatBodh-Dash/sample-output/result_transition.json`.

## Global Constraints

- Joint weight is `{"source": "base"}` only; no scenario donor, no `weights.external` (spec §2.2).
- `coverage_mode: "independent"`, no reference observation, no comparisons, no gender differential, no Other grouping (`other_grouping=False`), no explicit party `options` (they close the answer set and fail in ClickHouse, spec §10).
- Only major-by-major cells reach the payload; majors come from the alliance table (`MajorPartyProvider.identities(state, preset.alliance_reporting_type)`), ordered by `RuleSet.order("party", ..., states=[state])`.
- Matrix columns are exactly: Origin share %, Destination share %, Joint share %, Size of impact (pp). Flow summary main columns, in order: Net flow (pp), Retention share %, Gained population share %, Lost population share %, Acquisition share %; without a focal party only Agreement share %.
- An absent major-by-major cell is `absent: "no_respondents"` with every number `None`, shown as a dash with the reason "no respondents moved". Never a zero, never computed.
- No number is computed, summed or rounded in Python or TypeScript. Tests copy expected values from the engine sample.
- The engine job id inside the relationship operation is the constant `"relationship"`; `view` is never part of the engine config or fingerprint.
- A compile-time alliance read failure uses `AllianceUnavailable` (no raw cause shown); the engine's `ValueError` verdict is shown as "Alliance mapping: ...".
- Commit explicit paths only. Never stage `docs/specs/2026-11-08-dashboard-design.md`, `CLAUDE.md`, `prototypes/`, `uv.lock`, `.codegraph/`. Read a file with the Read tool before Edit.
- Gender value `Other` is never shown (owner ruling 2026-11-12, universal for all tables): one presentation rule `field: gender, hidden: [Other]` in `config/presentation/global.yaml`; the relationship translator drops any group whose dimension value `RuleSet.order(dim, [value], states=[state])` hides, so no group, cell or summary for it reaches the payload.
- Focal party must come from the alliance mapping (already the Task 2 rule); scenarios come from each round's dataset (`dataset.scenarios`), so no extra scenario validation beyond Task 2.
- Verification commands: backend `.venv/Scripts/python.exe -m pytest -q` from `matbodh-dashboard/`; frontend from `web/`: `npx vitest run`, `npm run typecheck`, `npm run build`.
- Live runs need VPN and the product owner's go-ahead each time.

## Review Focus

1. A group the engine reports (it is in `summaries`) that has no major-by-major cell at all, for example a small demographic group. Expected: the matrix shows nine dashes with the reason, not an empty table. Pinned in Tasks 3 and 8. (The gender `Other` group is not this case: it is hidden by the universal rule, Task 3 and Task 5.)
2. A focal party that is not an alliance identity. Expected: card unavailable with a plain reason, no engine run. Task 2.
3. A round that lacks either scenario. Expected: reported "not asked", absent from the Round chip; the anchor lacking one makes the card unavailable. Tasks 2 and 8.
4. An engine result with zero rows. Expected: payload with no groups; the card says "The engine returned no relationship rows." Tasks 3 and 8.
5. A cut with two dimensions (gender and age group) where the chosen value pair does not exist. Expected: "No such group in this round" instead of a stale table. Tasks 6 and 8.

---

### Task 1: Config, family spec, job kind

**Files:**
- Modify: `matbodh_dashboard/cards/config.py` (Family, constants, CardConfig, validation)
- Create: `matbodh_dashboard/cards/families/relationship.py`
- Modify: `matbodh_dashboard/cards/families/__init__.py` (register)
- Modify: `matbodh_dashboard/compiler/plan.py:22` (job kind)
- Test: `tests/cards/test_relationship_config.py`, extend `tests/cards/test_families.py`

**Interfaces:**
- Produces in `cards/config.py`:
  - `Family` literal gains `"relationship"`; `RELATIONSHIP_FAMILIES = frozenset({"relationship"})`; `RelationshipTable = Literal["summary", "matrix"]`.
  - `class RelationshipConfig(_Strict)`: `origin: str`, `destination: str`, `focal_party: str | None = None`, `include_recalled: dict[Literal["origin", "destination"], list[Literal["Did Not Vote", "Do Not Remember"]]] = {}`.
  - `class RelationshipViewConfig(_Strict)`: `table: RelationshipTable | None = None`.
  - `CardConfig.relationship: RelationshipConfig | None = None`; `CardConfig.view` becomes `BenchmarkViewConfig | RelationshipViewConfig | None`, chosen by `family` (a `mode="before"` validator on `CardConfig` picks the class; a benchmark card with `table: matrix` or a relationship card with `table: flips` fails).
- Produces: `FAMILIES["relationship"]` = `FamilySpec(name="relationship", scenario_kind="party", gender_differential=False, lenses=(), lens_sources={}, default_lens="", capabilities=Capabilities(modes=["standalone", "trend"], transpose=False))`.
- Produces: `EngineJob.kind` accepts `"relationship"`.

- [ ] **Step 1: Write failing tests** in `tests/cards/test_relationship_config.py` (helper `_card(**over)` builds `{"id": "relationship.t", "family": "relationship", "section": "relationships", "title": "T", "cuts": [[], ["gender"]], "relationship": {"origin": "vs_past", "destination": "vs_voting_intention", "focal_party": "NDA"}}`):
  - `test_valid_card_loads`: `_card()` validates; `.view is None`.
  - `test_view_table_is_checked_per_family`: `view={"table": "matrix"}` loads on a relationship card; `view={"table": "flips"}` raises; a `seat_benchmark` card with `view={"table": "matrix"}` raises.
  - `test_requires_relationship_block`: `relationship` removed raises; a distribution card carrying `relationship` raises.
  - `test_origin_and_destination_rules`: equal scenarios raise; an opinion scenario (`pm_satisfaction`) raises; an unknown scenario raises.
  - `test_include_recalled_only_on_a_recalled_endpoint`: `{"origin": ["Did Not Vote"]}` with origin `vs_past` loads; the same with origin `mla_choice_party` raises; `{"destination": [...]}` with destination `vs_voting_intention` raises; an unknown label raises.
  - `test_forbidden_blocks`: `scenarios`, `comparison` with mode `compare`, `caste_clubbing: true`, `rank`, `benchmark`, `filters` each raise.
  - `test_cuts_follow_grid_rules`: duplicate cut raises; `cuts: []` raises.
  - In `tests/cards/test_families.py`: the family list includes `relationship` and `family_meta(get_family("relationship")).capabilities.modes == ["standalone", "trend"]` (read the file first and extend its existing family-list assertion).
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest -q tests/cards/test_relationship_config.py tests/cards/test_families.py`. Expected: FAIL (unknown family).
- [ ] **Step 3: Implement** the interfaces above. Role check for `include_recalled` uses the engine catalogue (`_scenario_catalogue()` already in `config.py`): the scenario's `role == "recalled_vote"`. Reuse `scenario_kind` for the party-domain check. Add `_check_relationship` beside `_check_benchmark`, called from `_validate`; existing non-relationship branches must raise if `relationship` is set (extend the "applies to ... only" guard). Register `RELATIONSHIP` in `FAMILIES`. Widen the `EngineJob.kind` Literal.
- [ ] **Step 4: Run** the same command plus `-q` on `tests/cards`. Expected: PASS, no regression.
- [ ] **Step 5: Commit** `git add matbodh_dashboard/cards/config.py matbodh_dashboard/cards/families matbodh_dashboard/compiler/plan.py tests/cards/test_relationship_config.py tests/cards/test_families.py && git commit -m "feat: relationship card config and family spec"`.

### Task 2: Compile a relationship card

**Files:**
- Create: `matbodh_dashboard/cards/relationship/__init__.py`, `matbodh_dashboard/cards/relationship/compile.py`
- Modify: `matbodh_dashboard/cards/compile.py` (`compile_card` dispatch, lazy import like the benchmark's)
- Modify: `tests/compiler/engine_stub.py` (add `validate_relationship_with_engine`)
- Test: `tests/cards/test_relationship_compile.py`, `tests/cards/test_relationship_engine_loader.py`

**Interfaces:**
- Consumes: `MajorPartyProvider`, `AllianceUnavailable` (`cards/benchmark/parties.py`); `resolve_rounds`, `resolve_anchor`, `template_blockers`, `field_available`, `build_request`, `view_config`, `EngineJob`, `RunPlan` (see `cards/benchmark/compile.py` for the exact imports and the `plan()` closure pattern).
- Produces:
  - `relationship_majors(state: str, preset: MethodPreset, parties: MajorPartyProvider) -> frozenset[str]` (returns `parties.identities(state, preset.alliance_reporting_type)`).
  - `compile_relationship_card(config: CardConfig, ctx: StateContext, catalogue: Catalogue, preset: MethodPreset, *, parties: MajorPartyProvider | None) -> RunPlan`.
  - `compile_card(...)` routes `config.family in RELATIONSHIP_FAMILIES` to it (passes the existing `parties` argument).
  - Job: `EngineJob("relationship", "relationship", GRID, view_config(request, preset, relationship={...}))` where `relationship = {"id": "relationship", "origin": o, "destination": d, "weights": {"source": "base"}, "focal_party": focal}` plus `"answer_overrides": {"origin": {"include": [...]}, ...}` only when `include_recalled` is set.

- [ ] **Step 1: Write failing tests** in `tests/cards/test_relationship_compile.py`. Reuse the catalogue/ctx/preset/provider pattern of `tests/cards/test_benchmark_compile.py` (copy its `_catalogue` with `available_scenarios=["vs_past", "vs_voting_intention", "mla_choice_party"]`; `FakeParties` returns `frozenset({"NDA", "SP+", "BSP"})`):
  - `test_job_config_shape`: one job, `kind == "relationship"`, `part == "grid"`; `config["relationship"] == {"id": "relationship", "origin": "vs_past", "destination": "vs_voting_intention", "weights": {"source": "base"}, "focal_party": "NDA"}`; request `scenarios == ["vs_past", "vs_voting_intention"]`, `grouping_sets == [[], ["gender"]]`, `coverage_mode == "independent"`, `comparisons == []`, `gender_differential is None`, `parties["other_grouping"] is None`, `filters == []`; both rounds appear as observations.
  - `test_include_recalled_becomes_answer_overrides`.
  - `test_view_only_difference_gives_identical_job_config`: two cards differing only in `view.table`.
  - `test_unavailable_reasons` (parametrised, each gives `plan.jobs == ()` and a reason containing the text): `parties=None` -> "not configured"; focal `"INC"` -> "not a major party"; anchor round lacks `mla_choice_party` -> "was not asked in"; a cut field the survey lacks (`"occupation"`) -> "needs to exist"; context level below the cut's need via `template_blockers`.
  - `test_round_without_a_scenario_is_not_asked`: R1 lacks the origin, R2 (anchor) has both: one job over R2 only; `plan.not_asked == (("grid", ("2027 VS CAPI R1",)),)`.
  - `test_alliance_unreadable_is_unavailable_without_the_raw_error` and `test_engine_verdict_is_shown`: a provider raising `AllianceUnavailable("10.0.0.5 refused")` -> reason says "could not be loaded" and not the host; a provider raising `ValueError("Expected one state-level alliance context")` -> reason starts "Alliance mapping:".
  - In `tests/compiler/engine_stub.py` add `validate_relationship_with_engine(config: dict, rounds: list[ResolvedRound]) -> None`: build the request as `validate_benchmark_with_engine` does, then `relationship_from_dict(copy.deepcopy(config["relationship"]))` (`matbodh_dash.configuration`) and `resolve_relationship(LeaningEngine(), request, relationship)` (`matbodh_dash.joint_relationships`).
  - `tests/cards/test_relationship_engine_loader.py` (mirror `test_benchmark_engine_loader.py`, `importorskip` the engine): the compiled configs of the plain card and of an `include_recalled` card pass `validate_relationship_with_engine`.
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest -q tests/cards/test_relationship_compile.py tests/cards/test_relationship_engine_loader.py`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `compile_relationship_card` following `compile_benchmark_card`: resolve rounds and anchor; `template_blockers(config.requires.min_level, fields, ctx.level)` with `fields` = every cut dimension; used rounds = rounds whose `dataset.scenarios` contain both scenarios (anchor must be one, else unavailable "Scenario X was not asked in <anchor>"); other rounds -> `not_asked`; fields must exist in every used round (`field_available`); provider errors as in the Global Constraints; focal must be in `relationship_majors(...)`; `build_request(state=..., rounds=used, scenarios=[origin, destination], grouping_sets=config.cuts, preset=preset, other_grouping=False, coverage_mode="independent")`. In `compile_card` add the lazy-import branch next to the benchmark's.
- [ ] **Step 4: Run** the two test files and then `-q tests/cards tests/compiler`. Expected: PASS.
- [ ] **Step 5: Commit** explicit paths (`matbodh_dashboard/cards/relationship`, `matbodh_dashboard/cards/compile.py`, `tests/compiler/engine_stub.py`, the two test files) with message `feat: compile relationship cards`.

### Task 3: Payload and translator

**Files:**
- Create: `matbodh_dashboard/cards/relationship/payload.py`, `matbodh_dashboard/cards/relationship/translate.py`
- Create: `tests/fixtures/engine_samples/result_transition.json` (trimmed copy of `MatBodh-Dash/sample-output/result_transition.json`: keep every `summaries`, `populations`, `contract` entry; keep in `rows` all major-by-major rows (origin and destination in `BJP+`, `SP+`, `BSP`) plus the 30 largest other rows by `joint_mass`; this keeps the file small and still contains non-major rows to prove they are dropped)
- Create: `tests/cards/relationship_helpers.py`
- Test: `tests/cards/test_relationship_translate.py`

**Interfaces:**
- Consumes: `TranslateContext` (`cards/translate.py`), `CardConfig`, `RuleSet.order`.
- Produces in `payload.py` (all `_Strict` pydantic models, field names as spec §6): `RelationshipGroup(set_id: str, dimensions: dict[str, str])`; `RelationshipCell(round: str, group: RelationshipGroup, origin: str, destination: str, origin_share, destination_share, joint_share, size_of_impact_pp, joint_count, joint_mass, origin_base, destination_base, paired_base, paired_count: float | int | None, absent: Literal["no_respondents"] | None)`; `RelationshipSummary(round: str, group: RelationshipGroup, paired_count, paired_base, agreement_share, retention_share, loss_share, acquisition_share, conversion_share, retained_population_share, lost_population_share, gained_population_share, neither_population_share, net_flow_pp, composition_share, agreement_size_of_impact_pp, net_flow_size_of_impact_pp, retention_size_of_impact_pp, loss_size_of_impact_pp, acquisition_size_of_impact_pp, conversion_size_of_impact_pp, retained_population_impact_pp, gained_population_impact_pp, lost_population_impact_pp, neither_population_impact_pp, focal_origin_base, focal_destination_base, retained_mass, lost_mass, gained_mass, neither_mass, agreement_mass: float | None)`; `RelationshipPayload(kind="relationship", family, card_id, state, rounds: dict, origin: str, destination: str, focal_party: str | None, weights: dict, parties: list[str], groups: list[RelationshipGroup], tables_available: list[RelationshipTable], default_table: RelationshipTable, cells: list[RelationshipCell], summaries: list[RelationshipSummary], contract: dict, not_asked, unavailable, rules_version, engine_version, metadata_revision, alliance_epoch)`.
- Produces in `translate.py`: `translate_relationship(card: CardConfig, result: Mapping[str, Any], job_config: Mapping[str, Any], majors: Collection[str], context: TranslateContext) -> RelationshipPayload`. `round` is the engine `observation_id`; `groups` are the distinct `(grouping_set_id, dimensions)` of the engine `summaries`; `contract` keeps the spec §6 keys only; `default_table` is the card's `view.table` or `"summary"`.
- Produces in `relationship_helpers.py`: `load_transition() -> dict`, `relationship_card(**over) -> CardConfig` (focal `BJP+`, origin `vs_past`), `relationship_ctx(obs_ids: list[str], anchor: str) -> TranslateContext` (copy `ranked_ctx` from `tests/cards/ranking_helpers.py`), `JOB = {"relationship": {...base weights...}}`.

- [ ] **Step 1: Write failing tests** (majors `{"BJP+", "SP+", "BSP"}`; every expected number is read from `load_transition()` rows/summaries by key, except the literals below which are pinned):
  - `test_summary_copies_engine_values`: R2 Male summary `retention_share == 74.01705783351689`, `net_flow_pp == -7.806042401667394`, `gained_population_share == 5.1893381577919575`, `lost_population_share == 12.995380559459353`, `acquisition_share == 12.29438668589424`, `focal_origin_base == 244.80473394540334`, `paired_count == 211641`. Retention must not equal `retained_mass / paired_base * 100` (a wrong-base implementation).
  - `test_matrix_cells_are_major_by_major_only_and_include_the_diagonal`: every cell has origin and destination in majors; for R2 Male all nine ordered pairs are present, `BJP+ -> BJP+` included; a non-major row of the sample (an `IND_*` origin) is in the input and not in the payload.
  - `test_cell_numbers_come_from_the_matching_engine_row`: for the R2 Male `BJP+ -> SP+` cell the four display fields and `joint_count` equal that engine row's fields.
  - `test_absent_cell_is_a_dash_with_the_reason`: in a copy of the sample remove the engine row `BJP+ -> SP+` of R2 Male; that cell is present in the payload with every number `None` and `absent == "no_respondents"`, the other eight cells have numbers. A second case removes every major row of one group: nine absent cells, and the group still exists (it is in `summaries`).
  - `test_hidden_gender_value_is_dropped`: with a `RuleSet` hiding gender `Other` (a tmp rules YAML), no group, cell or summary has `dimensions == {"gender": "Other"}` while Male and Female remain; without the rule the `Other` group is carried (the translator hides nothing by itself).
  - `test_nothing_is_summed_or_computed`: monkeypatch-free check: no payload number outside the engine data (assert the set of non-None cell floats is a subset of the engine rows' float values for the same keys).
  - `test_without_a_focal_party_only_agreement_is_carried`: job config `focal_party=None` and an engine result whose summaries lack the focal fields: summary focal fields `None`, `agreement_share` copied.
  - `test_parties_follow_the_rule_set_order`: `payload.parties == ["BJP+", "SP+", "BSP"]` with a `RuleSet` ordering `[BJP+, SP+, BSP]` (build with `load_rules` from a tmp YAML as `tests/runner/test_service.py` does) and alphabetical after it for an unruled party.
  - `test_empty_result_gives_an_empty_payload`: `{"rows": [], "summaries": [], "populations": [], "contract": {...}}` -> `groups == []`, `cells == []`, `summaries == []`, no exception.
  - `test_contract_keeps_only_the_spec_keys`: `source_contracts` and `operations` absent; `identities`, `joint_weights`, `units`, `cross_round_pairing` present.
  - `test_view_table_sets_the_default`: `view.table == "matrix"` -> `default_table == "matrix"`; none -> `"summary"`; `tables_available == ["summary", "matrix"]`.
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest -q tests/cards/test_relationship_translate.py`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** payload models and `translate_relationship`. Cell lookup key: `(observation_id, grouping_set_id, json of dimensions, origin_party, destination_party)`. Generate the nine ordered major pairs per `(round, group)` that appears in `summaries`; fill from the engine row when present, otherwise the absent cell. Order cells by round, group, then party order.
- [ ] **Step 4: Run** the test file, then `-q tests/cards`. Expected: PASS.
- [ ] **Step 5: Commit** explicit paths (`matbodh_dashboard/cards/relationship`, the fixture, helpers, test) with `feat: relationship payload and translator`.

### Task 4: Runner and API wiring

**Files:**
- Modify: `matbodh_dashboard/runner/service.py` (`_Run`, `start`, `_assemble`)
- Test: extend `tests/runner/test_service.py`, `tests/api/test_app.py`

**Interfaces:**
- Consumes: `relationship_majors`, `translate_relationship`, `RELATIONSHIP_FAMILIES`.
- Produces: `_Run.majors: frozenset[str] | None = None` (relationship only, set in `start` after compile, like `endpoint_parties`); `_assemble` returns `translate_relationship(card, job.result, job.job.config, run.majors, context).model_dump()` for `RELATIONSHIP_FAMILIES`.

- [ ] **Step 1: Write failing tests** appended to `tests/runner/test_service.py` (copy the benchmark helper `_bench_service` at the end of the file and adapt it with a card `family="relationship"`, `relationship={"origin": "vs_past", "destination": "vs_voting_intention", "focal_party": "NDA"}`, `cuts=[[]]`; the catalogue must list `vs_past`):
  - `test_relationship_majors_are_fixed_at_start`: provider goes down after `start`; `status` is still `done` and the stubbed translator saw the majors from start.
  - `test_relationship_lookups_do_not_hold_the_service_lock` (same assertion as the benchmark's).
  - `test_relationship_run_assembles_a_payload`: with the real translator and a `FakeRunner` returning the Task 3 sample (`load_transition()`) for the relationship job, `status.result["kind"] == "relationship"` and the R2 Male retention equals the sample's.
  - In `tests/api/test_app.py`: `POST /cards/plan` and `/cards/run` for a relationship card return 200 and the plan has no `unavailable`; `GET /cards` lists the card with `family == "relationship"` and its `view` (read how the benchmark card test does it).
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest -q tests/runner/test_service.py tests/api/test_app.py -k relationship`. Expected: FAIL.
- [ ] **Step 3: Implement** the `_Run` field, the `start` branch (inside the existing family check, outside the lock) and the `_assemble` branch. `FakeRunner.part_of` in the tests needs no change (job part is `grid`).
- [ ] **Step 4: Run** `.venv/Scripts/python.exe -m pytest -q`. Expected: all pass.
- [ ] **Step 5: Commit** explicit paths with `feat: run and assemble relationship cards`.

### Task 5: Starter cards, fixture export and smoke support

**Files:**
- Modify: `config/cards/cards.yaml` (two cards), `config/presentation/global.yaml` (rule `field: gender`, `hidden: [Other]`)
- Modify: `scripts/export_card_fixtures.py` (relationship fixture), `scripts/smoke_card.py` (relationship report)
- Create: `web/src/test/fixtures/cards/relationship_transition.json` (generated by the export script)
- Test: `tests/cards/test_relationship_cards_yaml.py`, extend `tests/cards/test_fixture_export.py`

**Interfaces:**
- Produces cards: `relationship.up_past_to_current` (`origin: vs_past`, `destination: vs_voting_intention`, `focal_party: NDA`, `cuts: [[], [gender]]`, `view.table: summary`) and `relationship.up_mla_to_current` (`origin: mla_choice_party`, same destination, focal and cuts, `view.table: matrix`).
- Produces: `RELATIONSHIP_FIXTURES = ("relationship_transition",)` and `build_relationship_payload(name: str) -> dict` in `export_card_fixtures.py`, registered in the script's fixture list the way `BENCHMARK_FIXTURES` is (read the file first).
- Produces: `_relationship_lines(service, run_id, result, status) -> list[str]` in `smoke_card.py`, dispatched when `result.get("kind") == "relationship"`. It prints aggregates only: counts of groups, cells, absent cells, summaries, and per summary `retained + lost + gained + neither` against `paired_base` (printed as two numbers, no verdict computed beyond equality to 1e-9 relative).

- [ ] **Step 1: Write failing tests**: `test_relationship_cards_yaml.py` (mirror `test_benchmark_cards_yaml.py`): both cards load; each compiles to an available plan with the Task 2 fake catalogue and provider; their job configs differ only in `relationship.origin` and the request's `scenarios` (same cuts, focal and destination). In `test_fixture_export.py` extend the existing "fixtures are up to date" assertion to include the relationship fixture.
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement** the cards, the gender `Other` hidden rule (add a test in `tests/test_registry*.py` or `tests/cards/test_relationship_cards_yaml.py` that `load_rules(config/presentation).order("gender", ["Female", "Male", "Other"], states=["Uttar Pradesh"]) == ["Female", "Male"]`, watch it fail first), the exporter (translate the Task 3 sample with `relationship_card`/`relationship_ctx`, same pattern as `build_benchmark_payload`) and generate the web fixture with the script, and the smoke report.
- [ ] **Step 4: Run** `.venv/Scripts/python.exe -m pytest -q`. Expected: all pass.
- [ ] **Step 5: Commit** explicit paths with `feat: starter relationship cards, fixture and smoke report`.

### Task 6: Frontend types and pure row helpers

**Files:**
- Modify: `web/src/api/types.ts` (types, guards, `Family`, `CardPayload`, `CardInfo.view`)
- Create: `web/src/cards/relationship/relationshipRows.ts`
- Modify: `web/src/test/cardApi.ts` (`RELATIONSHIP.transition()`, lensless meta for the family)
- Test: `web/src/cards/relationship/relationshipRows.test.ts`, extend `web/src/api/types.test.ts`

**Interfaces:**
- Produces in `types.ts` (mirror `payload.py` names in camel-free snake case, as the benchmark types do): `RelationshipFamily = "relationship"`, `RelationshipTable = "summary" | "matrix"`, `RelationshipGroup`, `RelationshipCell`, `RelationshipSummary`, `RelationshipPayload`, `isRelationshipPayload(p: CardPayload): p is RelationshipPayload` (`kind === "relationship"`), `isRelationshipFamily(f: Family): f is RelationshipFamily`; `CardPayload` and `Family` include them; `CardInfo.view?: { table: BenchmarkTable | RelationshipTable | null } | null`.
- Produces in `relationshipRows.ts`:
  - `interface RelationshipView { table: RelationshipTable; round: string | null; cut: string | null; values: Record<string, string>; search: string; showDetails: boolean }`; `initialRelationshipView(p: RelationshipPayload): RelationshipView` (table from `default_table`, `round` = the anchor if it has data else the first round, `cut` and `values` = the first group's).
  - `cutsOf(p): { key: string; dimensions: string[] }[]` (distinct `set_id`, dimension names).
  - `valuesFor(p, cut: string, dimension: string): string[]` (distinct values present).
  - `matrixRows(p, view): { key: string; origin: string; destination: string; stayed: boolean; focal: boolean; cell: RelationshipCell }[]` for the selected round and group, or `null` when that group does not exist in that round.
  - `summaryRows(p, view): { group: RelationshipGroup; label: string; byRound: Record<string, RelationshipSummary | undefined> }[]` for the selected cut, search-filtered on the label.

- [ ] **Step 1: Write failing tests** with the Task 5 fixture: `initialRelationshipView` picks `summary`; `cutsOf` returns the overall and gender cuts; `valuesFor` returns `["Female", "Male"]` (any order, as a set; the fixture is built with the hidden rule); `matrixRows` for R2 Male has 9 rows, exactly 3 with `stayed`, focal rows flagged (`origin === focal || destination === focal`); for a synthetic group (a clone of R2 Male with its cells emptied to absent) all nine rows have `cell.absent === "no_respondents"`; a group value that does not exist returns `null` (Review Focus 5); `summaryRows` for the gender cut lists three rows with both rounds; a search for "fem" keeps one; no function mutates the payload (`structuredClone` equality).
- [ ] **Step 2: Run** `npx vitest run src/cards/relationship src/api/types.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** types and helpers; cardApi `RELATIONSHIP = { transition: () => relationshipOf(relationshipTransition) }` and `lenslessMeta` extended to the new payload (the existing helper takes `RankedPayload | BenchmarkPayload`).
- [ ] **Step 4: Run** `npx vitest run` and `npm run typecheck`. Expected: PASS, clean.
- [ ] **Step 5: Commit** explicit paths with `feat: relationship types and row helpers`.

### Task 7: Tables and CSV

**Files:**
- Create: `web/src/cards/relationship/RelationshipSummary.tsx`, `web/src/cards/relationship/RelationshipMatrix.tsx`, `web/src/cards/relationship/relationshipCsv.ts`
- Test: `web/src/cards/relationship/RelationshipTables.test.tsx`, `web/src/cards/relationship/relationshipCsv.test.ts`

**Interfaces:**
- Consumes: Task 6 helpers and types; `formatValue`/`formatPercent` from `web/src/cells/format` (look at how `BenchmarkTables.tsx` formats `pct`/`pp` and reuse the same helpers; percentages follow the owner's rule already inside `formatPercent`).
- Produces: `RelationshipSummaryTable({ payload, view }: { payload: RelationshipPayload; view: RelationshipView })`, `RelationshipMatrixTable({ payload, view })`, `relationshipToCsv(payload: RelationshipPayload, view: RelationshipView): string`, `FOOTNOTE: string` constants as named exports of the table files if the card needs them.

- [ ] **Step 1: Write failing tests** (fixture `RELATIONSHIP.transition()`):
  - Summary: header cells are exactly `["Group", "Net flow (pp)", "Retention share", "Gained population share", "Lost population share", "Acquisition share"]` in order; the R2 Male cell for retention contains the engine value formatted by the shared formatter and rounds appear as pipe segments (`data-segment`) in round order; each header carries a tooltip naming its base; with `showDetails` the extra fields appear (agreement, loss, conversion, neither, composition, bases, `paired_count`); with a payload whose `focal_party` is null only the Agreement column shows.
  - Matrix: header cells are exactly `["Origin → destination", "Origin share", "Destination share", "Joint share", "Size of impact (pp)"]`; nine body rows; diagonal rows carry the text "stayed"; focal rows have `data-focal`; an absent cell renders `–` with `title="no respondents moved"` and no number (assert no digit in that cell); for a synthetic all-absent group all four measure cells in all nine rows are dashes (Review Focus 1); with `showDetails` the counts and bases columns appear; a `null` matrix (missing group) renders "No such group in this round" (Review Focus 5).
  - CSV: summary CSV has the Details-free columns by default and every number equals the payload's `String(value)`; matrix CSV lists nine pair rows; absent cells are empty with a reason column.
- [ ] **Step 2: Run** `npx vitest run src/cards/relationship`. Expected: FAIL.
- [ ] **Step 3: Implement** the components with plain `<table>` markup like `BenchmarkTables.tsx` (caption, `scope` attributes, `rowgroup` per group in the summary, `aria-label` on pipe segments as `RankedTable` does).
- [ ] **Step 4: Run** `npx vitest run` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** explicit paths with `feat: relationship summary and matrix tables`.

### Task 8: Card, routing, drawer

**Files:**
- Create: `web/src/cards/relationship/RelationshipCard.tsx`
- Modify: `web/src/pages/CardsPage.tsx`, `web/src/cards/MethodDrawer.tsx`
- Test: `web/src/cards/relationship/RelationshipCard.test.tsx`, extend `web/src/pages/CardsPage.test.tsx`

**Interfaces:**
- Consumes: `useCardPlan`, `useCardRun<RelationshipPayload>` (no reference argument), the Task 6-7 modules, `PopoverChip`, `MethodDrawer`, `downloadCsv`, `coverageNote`.
- Produces: `RelationshipCard({ info, ctx }: { info: CardInfo; ctx: StateContext })`. `shown` is `run.current` only (never `run.previous`, as fixed in the benchmark polish). Handlers read `e.currentTarget.value` before calling any state updater.

- [ ] **Step 1: Write failing tests** (pattern of `BenchmarkCard.test.tsx`; stub with `stubCardApi({ payloads: [p] })`):
  - Opens on the card's own table (`view.table`) and falls back to Flow summary.
  - Table chooser switches display only: no new fetch (compare `f.mock.calls.length`).
  - Matrix: Round chip lists only rounds with data; picking a value chip for gender changes the rows; picking a value pair that does not exist shows "No such group in this round".
  - Search and Details are display-only.
  - A payload with no groups shows "The engine returned no relationship rows." (Review Focus 4).
  - `unavailable` plan shows the reasons and no table; failed run shows the kind message and Refresh; infrastructure errors are never shown raw.
  - Stale text is cleared while a new run is in progress (subtitle, chips, drawer absent when `run.current` is null).
  - Footer contains "Recalled vote, not longitudinal linkage" for origin `vs_past`, and "same-row answers, not a panel" otherwise, plus "Shares include respondents who chose smaller parties" and the method line.
  - A round that lacks a scenario is named in the footer through `not_asked`, and absent from the Round chip (Review Focus 3).
  - `CardsPage` renders a `RelationshipCard` for family `relationship`.
- [ ] **Step 2: Run** `npx vitest run src/cards/relationship src/pages`. Expected: FAIL.
- [ ] **Step 3: Implement** the card (structure of `BenchmarkCard.tsx`; subtitle `anchor round X · origin → destination · focal NDA`), route in `CardsPage.tsx` by `isRelationshipFamily`, and the `MethodDrawer` branch: for a relationship payload show `payload.contract` and the alliance identity versions (name the mapping version for origin and destination), joint weight, eligibility and units.
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run build`. Expected: PASS, clean.
- [ ] **Step 5: Commit** explicit paths with `feat: relationship card UI`.

### Task 9: Docs, full verification and live check

**Files:**
- Modify: `README.md` (relationship section and the live results), `docs/specs/2026-11-12-relationship-cards-design.md` (section 10 live evidence, section 11 status)
- Modify: `docs/testing.md` only if the repo has one for dashboard tests (check; otherwise only the README)

- [ ] **Step 1: Run the full suites**: `.venv/Scripts/python.exe -m pytest -q`; from `web/`: `npx vitest run`, `npm run typecheck`, `npm run build`, `npm run e2e` (needs installed Chrome and port 4173 free). Expected: all green; record the counts.
- [ ] **Step 2: Ask the owner for the live go-ahead**, then run (VPN, read-only) for both starter cards: `ENGINE_ENV_FILE=C:/Users/jogin/OneDrive/Desktop/matbodh-analytics-engine/MatBodh-Dash/.env .venv/Scripts/python.exe scripts/smoke_card.py --card relationship.up_past_to_current --state "Uttar Pradesh" --rounds "2027 VS CAPI R1" "2027 VS CAPI R2"` and the same for `relationship.up_mla_to_current`. Expected: `state=done`, groups and cells counts, the four-flow identity printed equal to the paired base for every summary, no `ERROR` lines. A failure for the `mla_choice_party` card is a finding to report (spec §11), not to patch by inventing a `weights.external`.
- [ ] **Step 3: Write the evidence** into the README relationship section and spec §10/§11 (what ran, timings, counts, what is still not verified: PC level, cohort filter, low-base threshold).
- [ ] **Step 4: Commit** `git add README.md docs/specs/2026-11-12-relationship-cards-design.md && git commit -m "docs: relationship cards live evidence and README"`.
