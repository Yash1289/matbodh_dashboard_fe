# Benchmark Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `seat_benchmark` card family: one engine benchmark run per card, shown as a table chooser (Comparison, Seat summary, Margin buckets, Flips) with major parties named and everything else in an engine-built Other row.

**Architecture:** A benchmark card compiles to one `EngineJob(kind="benchmark")` whose config is the engine's view JSON (`request` + `benchmark` + `alliances`), run by the existing `NamedSurveyRuntime` path. The card's engine part feeds the fingerprint; its view part does not, so copied cards share one cached result. The runner reshapes the engine tables into a `BenchmarkPayload` (copy only, dashes where an endpoint lacks a party); a React `BenchmarkCard` renders it.

**Tech Stack:** Python 3.11, pydantic v2, FastAPI, RQ/Redis (existing); React + Mantine + TanStack Query + vitest (existing); the `MatBodh-Dash` engine.

**Spec:** `docs/specs/2026-11-12-benchmark-cards-design.md` (read it first). Builds on `docs/plans/2026-11-11-ranking-cards.md` (same runner, labels and card-shell patterns).

## Global Constraints

- The engine owns every number. No task computes, re-ranks, rounds, sums or fills a vote share, seat count, margin, flip or Other value. Absent means `None` plus a reason, never `0`.
- **Engine dependency:** `MatBodh-Dash/matbodh_dash/benchmarking.py` must contain the Other-row change (summary built from `resolved`, `bm_summary_parties`). It was uncommitted on 2026-11-12; commit it in the engine repo before this branch is merged. Do not edit the engine repo from this plan.
- Major parties come from the alliance table only. No party label is hardcoded; `preset.keep` is not used for benchmark cards. NOTA is always in Other (`preset.competition_excluded`, currently `["NOTA"]`, is passed explicitly).
- Election endpoint party policy is `passthrough: true` (spec §3 rule 5). Both endpoints get the identical `other_grouping`: `{keep: <majors>, label: preset.other_label}`.
- The displayed list (`contenders`) and the kept list are the same list: the **superset** (union) of both endpoints' mapped identities, sorted for a stable fingerprint. `focal_party` must be in it.
- `view` (opening table, sort, density) never enters the engine config or the fingerprint.
- Source request filters, comparisons, display parties, gender and caste operations must be empty for a benchmark (engine rule, `matbodh_views/benchmark.py:_clean_source`).
- No SQL in the dashboard. Metadata lookups are small and read-only; the connection belongs to the host, closed after each lookup like `seat_snapshot_loader`.
- Run `.venv/Scripts/python.exe -m pytest -q` (from `matbodh-dashboard/`) and, in `web/`, `npx vitest run`, `npm run typecheck`, `npm run build`, `npm run e2e`. Skipped tests are not passed tests.
- Do not touch the user's uncommitted `docs/specs/2026-11-08-dashboard-design.md`. Commit explicit paths only. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Do not create per-task Markdown files; update `README.md` (Task 8).

## Review Focus

1. **A party mapped for one endpoint only** (UP: `INDI` in the 2022 mapping, not the survey): that side and its deltas show a dash with a reason, never 0. Test in Task 5.
2. **Election with no alliance context, or a compare round that is the anchor or not selected:** the card is unavailable with a reason before any run. Tests in Task 4.
3. **Focal party not among the majors:** unavailable with a reason (it would be folded into Other). Task 4.
4. **Two cards identical except `view`:** identical fingerprints, one engine job, one cache entry. Tasks 2 and 6.
5. **No seats common to both endpoints** (engine returns empty tables) and **PC level without membership** (engine error): the card says so in words, with no empty table and no 0. Tasks 6 and 7.

---

### Task 1: Fixture and plan-level constants

**Files:**
- Already added (commit it here): `tests/fixtures/engine_samples/result_benchmark_survey_vs_2022_other.json` (live UP result, survey R2 vs 2022 VS, 2026-11-12; aggregates only; endpoint ids `survey` and `historical`; contenders NDA, SP+, BSP; Other rows present).
- Create: `tests/cards/benchmark_helpers.py`
- Test: `tests/cards/test_benchmark_fixture.py`

**Interfaces:**
- Produces in `benchmark_helpers.py`: `load_benchmark_sample() -> dict` (parsed fixture); `FIXTURE_ENDPOINT_IDS = {"target": "survey", "reference": "historical"}`; `FIXTURE_MAJORS = ("BSP", "NDA", "SP+")`.

- [ ] **Step 1: Write the failing test** `test_fixture_shape_and_known_values` in `test_benchmark_fixture.py`: asserts the six list tables are present with 128 `summaries`, 64 `comparisons`, 192 `margin_buckets`, 64 `flips`; the `comparisons` row for `grouping_set_id == "g0"`, `party_id == "NDA"` has `target_seat_count == 154`, `reference_seat_count == 273`, `seat_count_delta == -119`; the `Other` row for g0 has `reference_seat_count == 4` and `vote_share_delta_pp` within 0.01 of `-4.71`; in every (endpoint, grouping_set, dimensions) group the `vote_share` of the summaries sums to 100 within 1e-6.
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/cards/test_benchmark_fixture.py -q`. Expected: FAIL (`benchmark_helpers` missing).
- [ ] **Step 3: Implement** `benchmark_helpers.py` with the three names above.
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Commit** the fixture, helper and test: `test: add live benchmark fixture`.

---

### Task 2: `CardConfig` family, engine part and view part

**Files:**
- Modify: `matbodh_dashboard/cards/config.py` (Family literal, `BenchmarkConfig`, `BenchmarkViewConfig`, `CardConfig.benchmark`/`.view`, validation, `BENCHMARK_FAMILIES`)
- Create: `matbodh_dashboard/cards/families/seat_benchmark.py`
- Modify: `matbodh_dashboard/cards/families/__init__.py` (register `SEAT_BENCHMARK`)
- Test: `tests/cards/test_benchmark_config.py`

**Interfaces:**
- Produces:
  - `BenchmarkTable = Literal["comparison", "summary", "margin_buckets", "flips"]`
  - `class BenchmarkConfig(_Strict)`: `focal_party: str | None = None`, `grouping_sets: list[list[str]] = [[]]` (default `[[], ]`; no duplicate sets; no duplicate attribute inside a set).
  - `class BenchmarkViewConfig(_Strict)`: `table: BenchmarkTable | None = None`.
  - `CardConfig.benchmark: BenchmarkConfig | None`, `CardConfig.view: BenchmarkViewConfig | None`.
  - `Family` gains `"seat_benchmark"`; `BENCHMARK_FAMILIES = frozenset({"seat_benchmark"})`.
  - `SEAT_BENCHMARK: FamilySpec` (lens-less, copy the shape of `families/seat_ranking.py`).
- Consumes: existing `_Strict`, `scenario_kind`, `CardConfig._validate`.

- [ ] **Step 1: Write failing tests** in `test_benchmark_config.py`: `test_valid_benchmark_card_loads` (yaml dict: family `seat_benchmark`, one scenario `vs_voting_intention`, `benchmark: {focal_party: NDA, grouping_sets: [[], [party_zone]]}`, `view: {table: comparison}`); `test_benchmark_needs_benchmark_block`; `test_benchmark_rejects_rank_and_caste_clubbing_and_delta_measures_and_filters`; `test_benchmark_needs_exactly_one_party_scenario` (an opinion scenario such as `pm_satisfaction` fails); `test_benchmark_comparison_must_be_standalone` (the reference is chosen on the card at run time, so `compare`/`trend` modes are rejected); `test_duplicate_grouping_sets_rejected`; `test_view_only_on_benchmark_family`.
- [ ] **Step 2: Run** `pytest tests/cards/test_benchmark_config.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the models and a `_check_benchmark(self)` branch in `CardConfig._validate` (mirror `_check_ranking`'s style); `families/seat_benchmark.py` registers a lens-less `FamilySpec` with `capabilities` modes `["standalone"]`, `transpose=False`, `sort=True`, `details=True`.
- [ ] **Step 4: Run** the new tests plus `tests/cards/test_families.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: seat_benchmark card config`.

---

### Task 3: Alliance-table party lists and the election list

**Files:**
- Create: `matbodh_dashboard/cards/benchmark/__init__.py`, `matbodh_dashboard/cards/benchmark/parties.py`, `config/elections.yaml`
- Modify: `matbodh_dashboard/bootstrap.py`, `matbodh_dashboard/api/app.py` (`GET /catalogue/{state}/elections`), `matbodh_dashboard/api/schemas.py`
- Test: `tests/cards/test_benchmark_parties.py`, `tests/api/test_app.py` (new test)

**Interfaces:**
- Produces in `parties.py`:
  - `class MajorPartyProvider(Protocol)`: `identities(state: str, reporting_type: str, *, year: int | None = None, election_type: Literal["LS", "VS"] | None = None) -> frozenset[str]` (canonical identities in that alliance mapping; raises `ValueError` with the engine's message when no single state-level context exists).
  - `class AllianceMajorParties`: `__init__(self, session_factory: Callable[[], ContextManager[Any]], epoch: Callable[[], int])`; implements the protocol over `matbodh_dash.alliance_runtime.AllianceSession(...).identity(state, reporting_type=..., year=..., election_type=...)` and returns `frozenset(identity.mapping.values())`; caches per `(state, reporting_type, year, election_type, epoch())`; drops older epochs.
  - `class ElectionOption(BaseModel)`: `year: int`, `election_type: Literal["LS", "VS"]`, `label: str` (`"2022 VS"`).
  - `load_elections(path: Path) -> dict[str, list[ElectionOption]]` (YAML: `{state: [{year, election_type}]}`; rejects unknown keys and duplicates).
- `config/elections.yaml` seeds **Uttar Pradesh only** with the seven contexts observed in the alliance table on 2026-11-12: 2009 LS, 2012 VS, 2014 LS, 2017 VS, 2019 LS, 2022 VS, 2024 LS. Other states are added by the product owner; do not invent them.
- `bootstrap.py`: `alliance_session_factory(settings)` (short-lived MySQL connection, same pattern as `seat_snapshot_loader`, closed on exit); `build_service_from_settings` sets `service.major_parties = AllianceMajorParties(...)` and `service.elections = load_elections(settings.config_dir / "elections.yaml")`.
- Endpoint: `GET /catalogue/{state}/elections` returns `list[ElectionOption]` (empty list for a state with none).

- [ ] **Step 1: Write failing tests** `test_identities_are_the_distinct_mapped_labels` (fake session factory whose `identity` returns a `PartyIdentity` mapping `{"a": "NDA", "b": "NDA", "c": "SP+"}` gives `frozenset({"NDA", "SP+"})`), `test_result_is_cached_per_epoch_and_refetched_after_epoch_bump`, `test_no_alliance_context_raises_the_engines_message`, `test_load_elections_rejects_duplicates`, and in the API test `test_elections_endpoint_lists_options_for_a_state`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** as specified. The lookup calls `AllianceSession(access.query)` from the short-lived connection and closes it in a `finally`.
- [ ] **Step 4: Run** the new tests and `tests/test_bootstrap.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: alliance-table major parties and election list`.

---

### Task 4: Compile a benchmark card

**Files:**
- Create: `matbodh_dashboard/cards/benchmark/reference.py`, `matbodh_dashboard/cards/benchmark/compile.py`
- Modify: `matbodh_dashboard/compiler/requests.py` (`build_request(..., keep: Sequence[str] | None = None)`), `matbodh_dashboard/cards/compile.py` (dispatch), `matbodh_dashboard/api/schemas.py` (`CardRequest.reference`), `matbodh_dashboard/api/app.py` (pass it), `matbodh_dashboard/runner/service.py` (`plan(...)`/`start(...)` take and forward `reference`)
- Test: `tests/cards/test_benchmark_compile.py`, `tests/compiler/test_requests.py` (new test for `keep`)

**Interfaces:**
- Produces in `reference.py`: `class BenchmarkReference(BaseModel)` (`extra="forbid"`): `kind: Literal["none", "compare", "election"]`, `year: int | None = None`, `election_type: Literal["LS", "VS"] | None = None`; validator: `election` needs both, others forbid them. Default when the request carries no reference: `compare` if `ctx.compare_round` else `none`.
- Produces in `compile.py`: `compile_benchmark_card(config: CardConfig, ctx: StateContext, catalogue: Catalogue, preset: MethodPreset, *, reference: BenchmarkReference | None, parties: MajorPartyProvider | None, elections: Mapping[str, Sequence[ElectionOption]]) -> RunPlan`; one job `EngineJob("benchmark", "benchmark", GRID, config)`.
- `compile_card(...)` gains keyword-only `reference=None, parties=None, elections=None` and forwards them for `config.family in BENCHMARK_FAMILIES` (lazy import, like ranking).
- Engine job config: `view_config(request, preset, benchmark=<dict>)` where `request = build_request(state, rounds=<anchor round plus compare round if the reference is compare>, scenarios=[scenario], grouping_sets=[], preset=preset, keep=majors)` and
  `benchmark = {"id": card.id, "seat_level": ctx.level, "target": {"source": "survey", "id": "target", "observation": <anchor obs_id>, "scenario": scenario}, "reference": <endpoint or None>, "contenders": sorted(majors), "focal_party": config.benchmark.focal_party, "grouping_sets": config.benchmark.grouping_sets, "filters": [], "seat_ids": [], "competition_excluded": preset.competition_excluded}`.
  A survey reference is `{"source": "survey", "id": "reference", "observation": <compare obs_id>, "scenario": scenario}`. An election reference is `{"source": "election", "id": "reference", "context": {"year": y, "election_type": t}, "parties": {"passthrough": True, "options": [], "other_grouping": {"keep": sorted(majors), "label": preset.other_label}}}`.
- Majors = `parties.identities(state, preset.alliance_reporting_type)` for the survey endpoint unioned with `parties.identities(..., year=y, election_type=t)` for an election reference. `seat_level` is `ctx.level` only for `ac`/`pc`; other levels make the card unavailable.
- Plan-time `unavailable` reasons (return a plan with no jobs): no `parties` provider; alliance lookup raised (message included); election not in `elections[ctx.state]`; compare reference but `ctx.compare_round` is missing, equals the anchor, or is not a selected round; `focal_party` not in majors (message: it would be folded into Other); level not `ac`/`pc`; PC level with an AC survey is allowed (the host loads membership); source-request cleanliness is guaranteed by construction.
- Consumes: `resolve_rounds`, `resolve_anchor`, `choose_coverage` is **not** used (the engine benchmark applies its own common coverage).

- [ ] **Step 1: Write failing tests** in `test_benchmark_compile.py` (fake provider and a catalogue helper reused from `tests/cards/ranking_helpers.py`): `test_survey_vs_survey_job_config_matches_the_engine_example_shape` (compare with the keys and values above; `competition_excluded == ["NOTA"]`; `request["parties"]["other_grouping"] == {"keep": ["BSP","NDA","SP+"], "label": "Other"}`); `test_election_reference_endpoint_and_passthrough_and_union_of_majors` (survey mapping `{NDA,SP+,BSP}`, 2022 mapping adds `INDI` ⇒ `contenders == ["BSP","INDI","NDA","SP+"]` and both `other_grouping.keep` lists equal); `test_no_reference_has_no_reference_endpoint`; `test_default_reference_is_compare_round_when_context_has_one`; one `test_unavailable_*` per reason listed above; `test_view_only_difference_gives_identical_job_config` (two cards equal except `view.table` ⇒ `job.config` dicts equal); `test_keep_override_in_build_request` in `tests/compiler/test_requests.py`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** as specified; `keep=None` keeps `preset.keep` for every existing caller.
- [ ] **Step 4: Run** `pytest tests/cards tests/compiler -q`. Expected: PASS, existing tests unchanged.
- [ ] **Step 5: Commit** `feat: compile seat_benchmark cards`.

---

### Task 5: Payload and translation

**Files:**
- Create: `matbodh_dashboard/cards/benchmark/payload.py`, `matbodh_dashboard/cards/benchmark/translate.py`
- Test: `tests/cards/test_benchmark_translate.py`, `tests/cards/test_benchmark_engine_loader.py`

**Interfaces:**
- Produces in `payload.py` (all `extra="forbid"`; mirrored in `web/src/api/types.ts`):
  - `AbsentReason = Literal["not_in_endpoint_mapping"]`
  - `BenchmarkGroup`: `set_id: str`, `dimensions: dict[str, str]`
  - `SummaryRow`: `endpoint: Literal["target","reference"]`, `group: BenchmarkGroup`, `party: str`, `eligible_seats: int`, `seats: int | None`, `seat_share: float | None`, `vote_share: float | None`, `support_mass: float | None`, `support_base: float | None`, `absent: AbsentReason | None`
  - `ComparisonRow`: `group`, `party`, `eligible_seats`, `target_vote_share`, `reference_vote_share`, `vote_share_delta_pp`, `target_seats`, `reference_seats`, `seat_delta`, `seat_share_delta_pp` (all `float | int | None`), `absent_sides: list[Literal["target","reference"]]`
  - `BucketRow`: `endpoint | None`, `group`, `bucket: str`, `seats: int`, `eligible_seats: int`; `FlipRow` the same without `endpoint`
  - `BenchmarkPayload`: `kind: Literal["benchmark"]`, `family`, `card_id`, `state`, `rounds: dict`, `reference: {"kind": "none"|"compare"|"election", "label": str | None}`, `focal_party: str | None`, `parties: list[str]` (the superset; `Other` is separate), `other_label: str`, `endpoint_parties: {"target": list[str], "reference": list[str]}`, `tables_available: list[BenchmarkTable]`, `default_table: BenchmarkTable`, `comparisons`, `summaries`, `margin_buckets`, `flips` (row lists), `contract: dict`, `unavailable: list[dict]`, `rules_version`, `engine_version`, `metadata_revision`, `alliance_epoch`.
- Produces in `translate.py`: `translate_benchmark(card: CardConfig, result: dict, job_config: dict, endpoint_parties: dict[str, frozenset[str]], context: TranslateContext) -> BenchmarkPayload`. Endpoint ids come from `job_config["benchmark"]["target"]["id"]` / `["reference"]["id"]`, never hardcoded. Values are copied from the engine rows unchanged. `Other` rows are passed through like any party.
- Rules inside `translate_benchmark`: for a (side, party) where `party` is not in that endpoint's identity set and is not the Other label, set that side's `SummaryRow` values to `None` with `absent="not_in_endpoint_mapping"`, and in `ComparisonRow` set both the affected side's values and every delta to `None` and list the side in `absent_sides`. `tables_available`: `summary` always; `comparison` if a reference; `margin_buckets` if a focal party; `flips` if both. `default_table = card.view.table` if it is in `tables_available`, else `comparison` when a reference exists, else `summary`. `seat_results` and `coverage` are not carried (spec §7 / §13 item 4; added when sub-project 5 needs them); coverage mode and versions stay in `contract`.

- [ ] **Step 1: Write failing tests** in `test_benchmark_translate.py` with the Task 1 fixture and `FIXTURE_ENDPOINT_IDS`: `test_values_are_copied_exactly` (NDA g0 comparison: `target_vote_share`, `reference_vote_share`, `vote_share_delta_pp` equal the engine row's floats exactly; `target_seats == 154`, `reference_seats == 273`, `seat_delta == -119`); `test_other_row_is_present_and_numbers_are_the_engines` (Other g0 reference seats 4, `vote_share_delta_pp` within 0.01 of -4.71; survey Other seats 0 is a real 0, `absent is None`); `test_named_parties_plus_other_sum_to_100_per_group` (every endpoint-group's `vote_share` sums to 100 within 1e-6 and `seats` to `eligible_seats`); `test_party_missing_from_one_endpoint_is_a_dash_not_zero` (pass `endpoint_parties={"target": {"NDA","SP+","BSP"}, "reference": {"NDA","SP+","BSP","INDI"}}` and add an `INDI` row with zeros to a copy of the engine result: the target side has `absent == "not_in_endpoint_mapping"`, all values `None`, and its comparison has `absent_sides == ["target"]` and every delta `None`); `test_tables_available_and_default_table` (reference vs none; `view.table="flips"` without a reference falls back to `summary`); `test_payload_has_no_seat_results`.
  `test_benchmark_engine_loader.py::test_compiled_config_loads_and_resolves_in_the_engine_offline`: build the Task 4 job config (fake parties) and pass it through the engine's strict loader (`matbodh_views.benchmark.benchmark_view_from_dict` and `validate_benchmark_view` with a `LeaningEngine` built as in `tests/compiler/engine_stub.py`) so a malformed spec fails here; skip with a reason only when the engine package is not importable (and say so in the run report).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** payload and translator as specified.
- [ ] **Step 4: Run** `pytest tests/cards -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: benchmark payload and translation`.

---

### Task 6: Runner assembly and sharing

**Files:**
- Modify: `matbodh_dashboard/runner/service.py` (`_assemble` branch, `major_parties`/`elections` attributes, `_ENGINE_ARRAYS`, pass `reference` through `plan`/`start`/`_Run`), `matbodh_dashboard/api/app.py` if Task 4 left wiring open
- Test: `tests/runner/test_service_benchmark.py`

**Interfaces:**
- Consumes: `compile_card(..., reference, parties=self.major_parties, elections=self.elections)`, `translate_benchmark`, `MajorPartyProvider`.
- `CardRunService.__init__` gains keyword-only `major_parties: MajorPartyProvider | None = None`, `elections: Mapping[str, Sequence[ElectionOption]] | None = None`. `_Run` stores the `reference` it was started with. `_assemble` for `seat_benchmark` calls `translate_benchmark(run.card, <the one done job's result>, run.jobs["benchmark"].job.config, endpoint_parties, context)` where `endpoint_parties` is recomputed from the provider with the same reference (cached, so no extra lookup). `_ENGINE_ARRAYS` gains `"summaries"` and `"comparisons"` for the log line only.

- [ ] **Step 1: Write failing tests** (fake queue/cache as in `tests/runner/test_service_ranking.py`): `test_benchmark_card_runs_one_job_and_assembles_a_payload` (queue receives exactly one submission; payload `kind == "benchmark"`); `test_two_cards_differing_only_in_view_share_one_engine_job` (two card ids, same context and reference: one queue submission, the second run is a cache hit, `default_table` differs between the two payloads); `test_changed_reference_is_a_new_fingerprint`; `test_failed_benchmark_fails_the_card_with_the_engines_message_and_no_payload`; `test_empty_engine_tables_give_a_payload_with_empty_row_lists_not_an_error` (no common seats).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the branch; a missing job result keeps the existing failed-card path.
- [ ] **Step 4: Run** `pytest tests/runner tests/api -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: run and assemble benchmark cards`.

---

### Task 7: Frontend card

**Files:**
- Create: `web/src/cards/benchmark/BenchmarkCard.tsx`, `web/src/cards/benchmark/BenchmarkTables.tsx`, `web/src/cards/benchmark/benchmarkRows.ts`, `web/src/cards/benchmark/benchmarkCsv.ts`, with `.test.ts(x)` files beside them
- Modify: `web/src/api/types.ts` (payload types, `isBenchmarkPayload`, `BenchmarkReference`, `ElectionOption`), `web/src/api/queries.ts` (`useElections(state)`; `useCardPlan`/`useCardRun` accept an optional `reference` that joins the query key and the POST body), `web/src/pages/CardsPage.tsx` (dispatch), `web/src/test/cardApi.ts` (benchmark fixture and stub, `elections`), `scripts/export_card_fixtures.py` (benchmark payload fixture, generated through `translate_benchmark` from the Task 1 sample)
- Test: as above, plus `web/e2e/` smoke if the ranking card has one

**Interfaces:**
- Produces: `BenchmarkCard({ info: CardInfo; ctx: StateContext })`; `benchmarkRows(payload: BenchmarkPayload, view: BenchmarkView): { groups: GroupRows[] }` with natural group ordering (AC 1, 2, 10) and `Other` last in every group; `benchmarkToCsv(payload, view): string`; `BenchmarkView = { table: BenchmarkTable; sort: ...; search: string; density: Density; showDetails: boolean }`.
- Behaviour: a **table chooser** chip lists only `payload.tables_available`; the opening table is `payload.default_table`; switching never fetches. A **reference picker** (NativeSelect: None, "Compare round (<name>)" when the context has one, each `useElections(ctx.state)` option) is the only control that changes the run; its caption says "Re-runs the engine". Cells with `absent` render a dash with a `title` carrying the reason ("not in this endpoint's mapping"); no `0` is ever synthesised. Percentages use the existing display formatters; the Other row is labelled with `payload.other_label`. An empty list for the shown table renders "No seats are covered by both endpoints" (reference set) or "No seats are covered" (none). The footer shows coverage mode, versions and a one-line note: "Other: every party outside the major list, and NOTA".
- Sort/Search/Density/Details/menu (method drawer, CSV, Refresh) mirror `RankingCard`. A chosen sort stores the **round or endpoint name**, not a positional id, and clears when the table or reference changes (the ranking stale-sort lesson).

- [ ] **Step 1: Write failing tests**: `benchmarkRows.test.ts` (`test_other_is_last_in_every_group`, `test_groups_use_natural_order`, `test_absent_cells_stay_null_and_are_never_zero`), `BenchmarkCard.test.tsx` (`test_opens_on_comparison_with_a_reference_and_summary_without`, `test_chooser_hides_tables_that_cannot_exist` (no reference ⇒ no Comparison or Flips), `test_chooser_switch_does_not_fetch`, `test_reference_picker_starts_exactly_one_new_run`, `test_dash_with_reason_for_a_party_missing_from_an_endpoint`, `test_exact_engine_values_render` (NDA all seats: "154", "273", "-89"), `test_empty_tables_say_so`, `test_copy_with_a_different_view_table_renders_the_other_tab_from_the_same_payload`), `benchmarkCsv.test.ts` (exports the visible table).
- [ ] **Step 2: Run** `npx vitest run src/cards/benchmark`. Expected: FAIL.
- [ ] **Step 3: Implement** the components and API changes; export the benchmark fixture through `scripts/export_card_fixtures.py` (run it, commit the JSON).
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run build`. Expected: all PASS, no type errors.
- [ ] **Step 5: Commit** `feat: benchmark card UI`.

---

### Task 8: Starter cards, docs, live check

**Files:**
- Modify: `config/cards/cards.yaml` (two benchmark cards), `README.md`, `scripts/smoke_card.py`
- Test: `tests/cards/test_benchmark_cards_yaml.py` (new), `tests/test_smoke_script.py` (extend for the benchmark report)

- Starter cards (chosen by the engineer, spec §2.2): `benchmark.up_zone_nda` (family `seat_benchmark`, section `benchmarks`, scenario `vs_voting_intention`, `benchmark: {focal_party: NDA, grouping_sets: [[], [party_zone]]}`, `view: {table: comparison}`, `requires: {min_level: ac}`) and a copy `benchmark.up_zone_nda_flips` with the same `benchmark` block and `view: {table: flips}`.
- `smoke_card.py` learns benchmark cards: prints the payload's tables, row counts, Other rows, any dash, and timings; accepts `--reference none|compare|election:2022:VS`.

- [ ] **Step 1: Write the failing tests** `test_cards_yaml_loads_both_benchmark_cards_and_they_share_an_engine_config` (both load; with a fake provider their compiled job configs are equal) and, in `tests/test_smoke_script.py`, a benchmark-report test using the Task 1 fixture (prints row counts, the Other rows and any dash).
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** the YAML and README section (how a card is copied to change only its view; the alliance-table rule; NOTA in Other; the engine dependency; what was not verified). Update the doc, not a new Markdown file.
- [ ] **Step 4: Run** the whole suites: `pytest -q`, `npx vitest run`, `npm run typecheck`, `npm run build`, `npm run e2e`. Report counts and skips.
- [ ] **Step 5: Live check (needs VPN and the product owner's go-ahead, read-only):** `ENGINE_ENV_FILE=<engine .env> .venv/Scripts/python.exe scripts/smoke_card.py --card benchmark.up_zone_nda --state "Uttar Pradesh" --rounds "2027 VS CAPI R1" "2027 VS CAPI R2" --reference election:2022:VS`, then `--reference compare` and `--reference none`. Expected: state `done`, one job, Other present, named parties plus Other sum to 100% per group, NDA 154 vs 273 seats statewide for the 2022 reference (compare with the fixture), runtime about 50 s. Record the results in the README and the final report; anything not run is listed as not run.
- [ ] **Step 6: Commit** `feat: starter benchmark cards, docs, smoke support`.

---

## Self-review (spec coverage)

- §3 rules 1 to 7 → Tasks 2, 4, 5, 6, 7 (chooser, view not fingerprinted, both endpoints, alliance table, passthrough, Other, engine dependency in Global Constraints).
- §4 and §4.1 → Tasks 2 and 4 (superset, no hardcoded list, dash rule in Task 5).
- §5 reference picker and election list → Tasks 3, 4, 7. **Plan decision for spec §13 item 3:** the picker lists `config/elections.yaml` (the product owner's own suggestion to store them locally); a listed election without a usable alliance context becomes "unavailable" with the engine's message, so no intersection with the election master is built.
- §6 compile and run, §7 payload, §8 card body, §9 errors, §10 tests, §11 live → Tasks 4 to 8. **Plan decision for spec §13 item 4:** `seat_results` and `coverage` are not carried in the v1 payload.
- §12.1 deferred seat-level Other items are not built (they belong to sub-project 5).
- `competition_excluded` comes from `preset.competition_excluded` (currently `["NOTA"]`), which equals the engine default the spec names.
