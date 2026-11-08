# Phase 1a — Dashboard Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Python backend that turns a dashboard context + State Pulse card into engine runs, executes them through the MatBodh engine in background workers, and returns normalised, ordered composite-cell results over an HTTP API.

**Architecture:** Pure layers (catalogue → context/capabilities → presets/templates → compiler → run plan) feed an engine runner executed by RQ workers; results are normalised into rows, assembled into composite cells, ordered by the presentation registry, cached in Redis and served by FastAPI. Every number comes from engine output; this code only reshapes, orders and labels.

**Tech Stack:** Python 3.11 (engine floor 3.10), engine `matbodh-survey-backend` 0.8.0 (editable path dependency `../MatBodh-Dash`), FastAPI, pydantic v2, PyYAML, redis + rq, pytest, fakeredis, httpx.

**Spec:** `docs/specs/2026-11-08-dashboard-design.md` (§3–§9, §12, §13, §16, §17, Appendix A). Plan 1b (frontend) follows this plan and consumes its API.

## Global Constraints

- The engine owns every number: no dashboard code sums, subtracts, averages or rescales survey values. Deltas, seat counts, shares and gender gaps are read from engine output fields only.
- Read-only database access; credentials only from the engine `.env` path given by `ENGINE_ENV_FILE`; never commit `.env`.
- Engine query limits: `max_execution_time=120`, `max_result_rows=100000`.
- Round order comes from metadata (`cycle_id` year, then `round_number`), never from labels.
- NULL is not zero: missing values stay `None` and carry a flag (`not_asked`, `no_base`, `not_contender`).
- Values are never dropped for lack of a presentation rule; unknown values are appended.
- Survey level = `collection_level`; rounds combine only within one state and one level.
- Extrapolated is the default version; a missing Extrapolated version falls back to Normal and the fallback is recorded.
- Alliances: `{"reporting_type": "MatBodh"}`; default mapping only (the spec §6.1 engine changes are out of scope).
- Engine sources (exact): `warehouse.sra_v2_survey_responses_rmt`, `warehouse.ac_population_factor_dict_v2`, `warehouse.reporting_value_mapping_dict_v2`, `warehouse.reporting_value_mapping`; metadata tables `warehouse.survey_datasets`, `warehouse.survey_dataset_levels`.
- Tests use pytest; numerical fixtures must distinguish wrong implementations (e.g. a provided Δ that does not equal the difference of the displayed values).

## Review Focus

1. **A round that did not ask the question** — its cell must read `None` with flag `not_asked`, not 0 and not a whole-card failure. Test: Task 10 `test_not_asked_round_is_flagged_not_zero`.
2. **A party winning seats outside the keep list** (spike: JDL, 2 AC seats in R1) — it gets its own scoreboard row with its benchmark vote share and is never summed into Other. Test: Task 10 `test_seat_winner_outside_keep_list_gets_own_row`.
3. **A geographic slice over rounds with different seat coverage** — compiles to `coverage_mode: "common"`; identical coverage stays `independent`. Test: Task 6 `test_geographic_slice_uses_common_when_coverage_differs`.
4. **Extrapolated requested but absent** (spike: UP 2027 R1/R2) — uses Normal and records `fallback=True`. Test: Task 6 `test_missing_extrapolated_falls_back_to_normal`.
5. **One engine job fails inside a card** (e.g. the PC benchmark raises `ValueError`) — the card returns the other parts plus a classified error for the failed part; cached successes stay usable. Test: Task 12 `test_failed_job_marks_only_its_parts`.

---

### Task 1: Repository scaffold

**Files:**
- Create: `pyproject.toml`, `.gitattributes`, `.gitignore`, `README.md`, `matbodh_dashboard/__init__.py`, `matbodh_dashboard/settings.py`
- Test: `tests/test_scaffold.py`

**Interfaces:**
- Produces: `@dataclass(frozen=True) Settings(engine_env_file: Path, redis_url: str, cache_ttl_seconds: int, config_dir: Path)`; `load_settings() -> Settings` reading `ENGINE_ENV_FILE` (required), `DASHBOARD_REDIS_URL` (default `redis://localhost:6379/0`), `DASHBOARD_CACHE_TTL_SECONDS` (default `86400`, placeholder for open decision §20.6), `DASHBOARD_CONFIG_DIR` (default `<repo>/config`); `engine_version() -> str` via `importlib.metadata.version("matbodh-survey-backend")`.

- [ ] **Step 1: Write the failing tests** — `test_engine_importable_and_version`: `import matbodh_dash`; `engine_version() == "0.8.0"`. `test_settings_defaults(monkeypatch)`: with `ENGINE_ENV_FILE` set and the others unset → `cache_ttl_seconds == 86400`, `redis_url == "redis://localhost:6379/0"`. `test_settings_require_env_file`: unset → `ValueError("ENGINE_ENV_FILE is required")`.
- [ ] **Step 2: Run** `pytest tests/test_scaffold.py -v` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `pyproject.toml` (project `matbodh-dashboard`, `requires-python = ">=3.10"`, deps `fastapi`, `uvicorn`, `pydantic>=2`, `pyyaml`, `redis`, `rq`, `httpx`; extra `dev = [pytest, fakeredis]`), `.gitattributes` (`* text=auto eol=lf`), `.gitignore` (`.venv/`, `__pycache__/`, `.env`, `*.local.json`), README (setup incl. `pip install -e ../MatBodh-Dash[host]`, test command, links to the spec and this plan), `settings.py`.
- [ ] **Step 4: Run** `pytest tests/test_scaffold.py -v` — Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "chore: scaffold dashboard backend package"`

### Task 2: Round identity and labels

**Files:**
- Create: `matbodh_dashboard/catalogue/__init__.py`, `matbodh_dashboard/catalogue/labels.py`
- Test: `tests/catalogue/test_labels.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) RoundIdentity(state: str, cycle: str, series: str, round: int | None, base_name: str)` with property `sort_key -> tuple[int, str, str, int]` = `(cycle year, rest of cycle, series, round or 0)`.
  - `parse_round(state: str, survey_name: str, cycle_id: str, round_number: int | None) -> RoundIdentity` — strips a trailing ` (Extrapolated)`; series = base name minus the `cycle_id` prefix and the `R<n>` token, whitespace-normalised.
  - `short_labels(rounds: Sequence[RoundIdentity]) -> dict[RoundIdentity, str]` — only differing parts: one series → `"R1"`; several series in one cycle → `"CAPI R1"`; several cycles → `"22 CAPI R4"` (two-digit year).
  - `series_groups(rounds: Sequence[RoundIdentity]) -> list[tuple[str, list[RoundIdentity]]]` — ordered groups with header `"2027 VS · CAPI"`.

- [ ] **Step 1: Write the failing tests** — `test_parse_plain` (`"2027 VS CAPI R1"`, cycle `"2027 VS"`, 1 → series `"CAPI"`, round 1); `test_parse_extrapolated_suffix` (`"2027 VS CAPI R2 (Extrapolated)"` → base_name `"2027 VS CAPI R2"`); `test_parse_rebel_series` (`"2027 VS CAPI REBEL R1"` → series `"CAPI REBEL"`); `test_parse_no_round` (`"2027 VS CAPI ST"`, None → round None); `test_short_labels_single_series` → `["R1", "R2"]`; `test_short_labels_mixed_cycles` (2022 VS CAPI R4 + 2027 VS CAPI R2) → `["22 CAPI R4", "27 CAPI R2"]`; `test_series_groups_order` (input 2027 R2, 2022 R4, 2027 R1 → headers `["2022 VS · CAPI", "2027 VS · CAPI"]`, 2027 group ordered R1, R2).
- [ ] **Step 2: Run** `pytest tests/catalogue/test_labels.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** the four symbols in `labels.py` (regex `\bR(\d+)\b` for the round token).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: parse survey round identity and short labels"`

### Task 3: Catalogue store

**Files:**
- Create: `matbodh_dashboard/catalogue/store.py`
- Test: `tests/catalogue/test_store.py`, `tests/fixtures/catalogue_rows.py`

**Interfaces:**
- Consumes: `parse_round`, `RoundIdentity` (Task 2).
- Produces:
  - `@dataclass(frozen=True) DatasetVersion(dataset_id: str, survey_name: str, variant: Literal["normal", "extrapolated"], level: Literal["ac", "pc", "zone", "state"], seat_ids: frozenset[int], borrowed_seat_ids: frozenset[int], fields: frozenset[str], scenarios: frozenset[str], start_date: date | None, end_date: date | None, revision: int)`.
  - `@dataclass(frozen=True) CatalogueRound(identity: RoundIdentity, level: str, normal: DatasetVersion | None, extrapolated: DatasetVersion | None)` with `version(mode: Literal["extrapolated", "matched"]) -> tuple[DatasetVersion, bool]` returning `(dataset, fallback_used)`; `matched` always returns Normal.
  - `class Catalogue`: `states() -> tuple[str, ...]`, `rounds(state: str, level: str | None = None) -> tuple[CatalogueRound, ...]` (sorted by `identity.sort_key`), `find(state: str, base_name: str) -> CatalogueRound` (`KeyError` if absent), `revision: int` (max `update_revision`).
  - `load_catalogue(query: Callable[[str, Mapping[str, object]], list[dict]]) -> Catalogue` — two read-only queries: `warehouse.survey_datasets FINAL WHERE is_active = 1`; `warehouse.survey_dataset_levels FINAL WHERE is_active = 1` grouped by `dataset_id` returning `groupArray(level_id) AS seat_ids, groupArrayIf(level_id, is_borrowed = 1) AS borrowed`.
  - `clickhouse_query(client) -> Callable` wrapping `client.query(sql, parameters=params, settings={"readonly": 1, "max_execution_time": 60})` into row dicts.

- [ ] **Step 1: Write the failing tests** with fixture rows for Uttar Pradesh: `2027 VS CAPI R1` normal ac (seats 1–380), `2027 VS CAPI R2` normal ac (1–403), `2027 VS CAPI R2 (Extrapolated)` ac (1–403, borrowed 381–403), `2027 VS CAPI ST R1` zone. Tests: `test_rounds_pair_normal_and_extrapolated`; `test_rounds_filtered_by_level` (ac → 2, zone → 1); `test_missing_extrapolated_falls_back` (`R1.version("extrapolated") == (normal, True)`); `test_borrowed_seats_loaded` (23); `test_revision_is_max_update_revision`.
- [ ] **Step 2: Run** `pytest tests/catalogue -v` — Expected: FAIL.
- [ ] **Step 3: Implement** `store.py`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: load survey catalogue from metadata tables"`

### Task 4: Context model and capability table

**Files:**
- Create: `matbodh_dashboard/context.py`, `matbodh_dashboard/capability.py`
- Test: `tests/test_context.py`, `tests/test_capability.py`

**Interfaces:**
- Consumes: `Catalogue` (Task 3).
- Produces:
  - pydantic (`extra="forbid"`) `StateContext(state: str, level: Literal["ac", "pc", "zone", "state"], rounds: list[str], compare_round: str | None = None, anchor_round: str | None = None, version_mode: Literal["extrapolated", "matched"] = "extrapolated", geo_scope: Literal["state", "zone", "district", "seat"] = "state")` — `rounds` are base names; `Context(states: list[StateContext], focus_party: str | None = None)`.
  - `@dataclass(frozen=True) Capabilities(geo_slices: frozenset[str], seat_levels: frozenset[str], version_modes: frozenset[str])`; `capabilities(level: str) -> Capabilities`: ac → geo `{"zone", "party_zone", "district", "pc_num", "ac_num"}`, seats `{"ac", "pc"}`, versions `{"extrapolated", "matched"}`; pc → geo `{"pc_zone", "pc_num"}`, seats `{"pc"}`, versions `{"extrapolated", "matched"}`; zone/state → geo `∅`, seats `∅`, versions `{"extrapolated"}`.
  - `validate_context(ctx: StateContext, catalogue: Catalogue) -> list[str]` (empty = valid); `resolve_anchor(ctx: StateContext, catalogue: Catalogue) -> str` (latest by sort key when `anchor_round` is None).

- [ ] **Step 1: Write the failing tests** — one test per capability row above; `test_rounds_must_share_level` (an ac round with a zone round → error naming both); `test_compare_round_must_be_selected`; `test_matched_rejected_for_state_level`; `test_anchor_defaults_to_latest` (R1, R2 → `"2027 VS CAPI R2"`); `test_unknown_round_rejected`.
- [ ] **Step 2: Run** `pytest tests/test_context.py tests/test_capability.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: context model and survey-level capabilities"`

### Task 5: Method presets and State Pulse templates

**Files:**
- Create: `matbodh_dashboard/presets.py`, `matbodh_dashboard/templates.py`, `config/presets/uttar-pradesh.standard-v1.yaml`, `config/templates/pulse.yaml`
- Test: `tests/test_presets_templates.py`

**Interfaces:**
- Produces:
  - pydantic (`extra="forbid"`) `MethodPreset(id: str, version: int, weights: WeightSpec(mode, invalid, zero), answers_excluded: list[str], strip_whitespace: bool, keep: list[str], other_label: str, passthrough: bool, opinion_weights: OpinionWeightSpec(source: Literal["base", "scenario"], scenario: str | None = None, mode: str | None = None), caste_threshold_pct: float, gender: GenderSpec(field, female: list[str], male: list[str]), competition_excluded: list[str], alliance_reporting_type: str)`; `load_preset(path: Path) -> MethodPreset`.
  - pydantic (`extra="forbid"`) `CardTemplate(id: str, section: str, title: str, operation: Literal["scoreboard", "distribution", "opinion"], questions: list[str], measures: list[str], slices: list[str] = [], cell: list[str], density: Literal["compact", "standard", "detailed"], requires: Requirements(min_level: Literal["state", "ac"], focus_party: bool = False))`; `load_templates(path: Path) -> dict[str, CardTemplate]`.
- Preset values (provisional, spec §20.2 + Appendix A): weights `mj_cap` / `exclude` / `include`; answers_excluded `[""]`; strip true; keep `["NDA", "SP+", "BSP"]`; other_label `"Other"`; passthrough true; opinion_weights `{source: base}`; caste 0.5; gender `gender`, `["Female"]`, `["Male"]`; competition_excluded `["NOTA"]`; reporting type `"MatBodh"`.
- Templates in `pulse.yaml`: `pulse.party_scoreboard` (scoreboard; `vs_voting_intention`; measures `support_share, seats_ac, seats_pc, gender_gap`; cell `value, delta, trend`; min_level `state` — seat columns follow capabilities); `pulse.leaders` (opinion; `pm_satisfaction, cm_satisfaction, state_govt_satisfaction, central_govt_satisfaction`; measure `net_score`); `pulse.change_appetite` (opinion; `state_govt_change`; measures `positive_share, negative_share, net_score`); `pulse.by_zone` (distribution; `vs_voting_intention`; slices `["party_zone"]`; min_level `ac`).

- [ ] **Step 1: Write the failing tests** — `test_preset_loads_provisional_values` (asserts every value above); `test_preset_rejects_unknown_key`; `test_pulse_templates_present` (4 ids); `test_by_zone_requires_ac_level`.
- [ ] **Step 2: Run** `pytest tests/test_presets_templates.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** the models, loaders and two YAML files.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: method preset and State Pulse card templates"`

### Task 6: Request compiler (rounds, coverage, engine request JSON)

**Files:**
- Create: `matbodh_dashboard/compiler/__init__.py`, `matbodh_dashboard/compiler/rounds.py`, `matbodh_dashboard/compiler/coverage.py`, `matbodh_dashboard/compiler/requests.py`
- Test: `tests/compiler/test_rounds.py`, `tests/compiler/test_coverage.py`, `tests/compiler/test_requests.py`, `tests/compiler/engine_stub.py`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `@dataclass(frozen=True) ResolvedRound(obs_id: str, label: str, identity: RoundIdentity, dataset: DatasetVersion, fallback: bool)`; `resolve_rounds(ctx: StateContext, catalogue: Catalogue) -> list[ResolvedRound]` — obs_id `"o1"…"oN"` in sort order; label from `short_labels`.
  - `choose_coverage(rounds: Sequence[ResolvedRound], *, uses_seat_ids: bool, geographic: bool, version_mode: str) -> Literal["independent", "common"]` — `"common"` if `uses_seat_ids`; or `version_mode == "matched"` and (`uses_seat_ids` or `geographic`); or `geographic` and the rounds' `dataset.seat_ids` sets differ; otherwise `"independent"`.
  - `build_request(*, state: str, rounds: Sequence[ResolvedRound], scenarios: list[str], grouping_sets: list[list[str]], preset: MethodPreset, comparisons: Sequence[dict] = (), gender: bool = False, coverage_mode: str = "independent", other_grouping: bool = True) -> dict` — engine Request JSON with named observations `{"id": obs_id, "survey_name": dataset.survey_name}`; `reference_observation` set to the latest round only when `coverage_mode == "common"`.
  - `comparison(target: ResolvedRound, reference: ResolvedRound, scenario: str, measure: str = "support_share") -> dict` with id `f"d-{scenario}-{target.obs_id}-{reference.obs_id}"`.
  - `view_config(request: dict, preset: MethodPreset, **operations) -> dict` adding `sources` (Global Constraints) and `alliances`.

- [ ] **Step 1: Write the failing tests** — `test_missing_extrapolated_falls_back_to_normal` (Review Focus 4); `test_matched_uses_normal`; `test_geographic_slice_uses_common_when_coverage_differs` (R1 380 vs R2 403 seats → `"common"`; both 403 → `"independent"`; Review Focus 3); `test_seat_ids_force_common`; `test_scoreboard_request_snapshot` (two rounds, `vs_voting_intention`, `[[]]`, one comparison o2 vs o1, gender on → equals an expected literal including `parties.other_grouping.keep == ["NDA", "SP+", "BSP"]`, `gender_differential == {"field": "gender", "female_values": ["Female"], "male_values": ["Male"]}`, `coverage_mode == "independent"`); `test_request_accepted_by_engine` (a stub session whose `request()` replaces named observations with explicit `Observation` fields from the fixture datasets, then `matbodh_dash.configuration.request_from_dict` and `LeaningEngine().resolve(...)` complete without raising).
- [ ] **Step 2: Run** `pytest tests/compiler -v` — Expected: FAIL.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: compile rounds, coverage and engine requests"`

### Task 7: Run plans and fingerprints

**Files:**
- Create: `matbodh_dashboard/compiler/plan.py`, `matbodh_dashboard/compiler/fingerprint.py`
- Test: `tests/compiler/test_plan.py`, `tests/compiler/test_fingerprint.py`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces:
  - `@dataclass(frozen=True) EngineJob(key: str, kind: Literal["analysis", "benchmark"], part: str, config: dict, contenders_from: str | None = None)` — `part` ∈ `{"vote", "seats_ac", "seats_pc", "opinion", "zone"}`; `key` unique within the plan.
  - `@dataclass(frozen=True) RunPlan(card_id: str, state: str, rounds: tuple[ResolvedRound, ...], anchor: str, compare: str | None, jobs: tuple[EngineJob, ...], unavailable: tuple[tuple[str, str], ...])` — `(part, reason)` pairs.
  - `plan_card(template: CardTemplate, ctx: StateContext, catalogue: Catalogue, preset: MethodPreset) -> RunPlan`:
    - scoreboard → one `vote` analysis job (support + comparison anchor vs compare + gender); for each seat level allowed by `capabilities(ctx.level)`, one paired benchmark (target = anchor, reference = compare, `focal_party: None`, `grouping_sets: [[]]`, `contenders: []`, `contenders_from: "vote"`) plus one single-endpoint benchmark per other selected round; zone/state level → `unavailable` contains `("seats_ac", "Seat views need an AC or PC level survey")` and `("seats_pc", ...)`;
    - opinion → one analysis job, comparisons `measure="net_score"`;
    - by-zone → grouping `[[], ["party_zone"]]`, coverage from `choose_coverage(..., geographic=True)`.
  - `bind_contenders(job: EngineJob, parties: Sequence[str], preset: MethodPreset) -> EngineJob` — contenders = sorted `parties` minus `preset.competition_excluded` minus `preset.other_label`.
  - `fingerprint(config: dict, *, metadata_revision: int, engine_version: str, alliance_epoch: int) -> str` — sha256 hex of canonical JSON (`sort_keys=True, separators=(",", ":")`).

- [ ] **Step 1: Write the failing tests** — `test_scoreboard_two_rounds_ac` → 3 jobs (vote, seats_ac pair, seats_pc pair); `test_scoreboard_three_rounds_adds_single_benchmarks` → 5 jobs; `test_scoreboard_pc_level_has_no_ac_seats`; `test_scoreboard_state_level_marks_seats_unavailable`; `test_bind_contenders_excludes_nota_and_other` (`["NDA", "SP+", "BSP", "JDL", "NOTA", "Other"]` → `["BSP", "JDL", "NDA", "SP+"]`); `test_fingerprint_stable_under_key_order`; `test_fingerprint_changes_with_revision_engine_and_epoch`.
- [ ] **Step 2: Run** `pytest tests/compiler/test_plan.py tests/compiler/test_fingerprint.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: card run plans and config fingerprints"`

### Task 8: Engine runner and error classification

**Files:**
- Create: `matbodh_dashboard/runner/__init__.py`, `matbodh_dashboard/runner/engine.py`
- Test: `tests/runner/test_engine.py`

**Interfaces:**
- Produces:
  - `class EngineError(Exception)` with attributes `kind: Literal["config", "too_heavy", "infrastructure"]`, `message: str`.
  - `classify(exc: BaseException) -> EngineError` — message containing `TOO_BIG_AST`, `TIMEOUT_EXCEEDED` or `TOO_MANY_ROWS` → `too_heavy` (checked first); `ConnectionError`, `TimeoutError`, `OSError` → `infrastructure`; everything else (incl. `ValueError`) → `config`.
  - `class EngineRunner(runtime)` with `run(config: dict) -> dict` — writes `config` to a temporary `.json` file, calls `runtime.run(path)`, returns `dataclasses.asdict(result)`, always deletes the file, raises `classify(exc)` on failure.
  - `build_runtime(env_file: Path)` — opens `create_mysql_connection(env_file)` and `create_clickhouse_client(env_file)`, wraps ClickHouse in `ClickHouseConnectAdapter(client, max_execution_time=120, max_result_rows=100000)`, returns `NamedSurveyRuntime(MySQLAccess(MySQLReadAdapter(mysql)), MetadataSession(query))`.

- [ ] **Step 1: Write the failing tests** — `test_run_returns_asdict` (fake runtime returning a small dataclass); `test_temp_file_removed_on_error`; `test_classify` table: `ValueError("Missing factor")` → config, `RuntimeError("Code: 168. TOO_BIG_AST")` → too_heavy, `ConnectionError()` → infrastructure, `ValueError("TIMEOUT_EXCEEDED")` → too_heavy.
- [ ] **Step 2: Run** `pytest tests/runner/test_engine.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** `engine.py`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: engine runner with error classification"`

### Task 9: Result normaliser

**Files:**
- Create: `matbodh_dashboard/normalise/__init__.py`, `matbodh_dashboard/normalise/rows.py`
- Test: `tests/normalise/test_rows.py`, `tests/fixtures/engine_results.py` (synthetic dicts shaped like the Appendix A outputs)

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) NormalRow(state: str, obs_id: str | None, measure: str, series: str, dims: tuple[tuple[str, str | None, bool], ...], value: float | None, unit: Literal["pct", "pp", "seats"], base: float | None, flags: frozenset[str])` — `dims` entries `(name, value, is_subtotal)`.
  - `from_analysis(result: dict, state: str) -> list[NormalRow]` — measures: `support_share` (from `rows`; base `weighted_denominator`); `delta_support` (from `comparisons.percentage_point_difference`, obs_id = target observation); `gender_gap`, `female_share`, `male_share` (from `gender_differentials`); `net_score`, `positive_share`, `negative_share` (from `scores`); a gender row with `coverage_status != "available"` → value `None` + flag `no_base`; `context_status == "no_eligible_result"` contributes no rows.
  - `from_benchmark(result: dict, state: str, level: Literal["ac", "pc"]) -> list[NormalRow]` — `summaries` → `seats_{level}` (`seat_count`, obs_id = `endpoint`) and `vote_share_bench` (`vote_share`); `comparisons` → `delta_seats_{level}` (`seat_count_delta`, obs_id = the target endpoint).

- [ ] **Step 1: Write the failing tests** — `test_support_rows_keep_base`; `test_comparison_rows_use_engine_delta` (the fixture Δ deliberately differs from the difference of the two shares; the normaliser returns the fixture Δ); `test_gender_gap_rows`; `test_null_gender_base_flagged`; `test_subtotal_dims_marked`; `test_benchmark_summaries_and_seat_delta`.
- [ ] **Step 2: Run** `pytest tests/normalise/test_rows.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** `rows.py`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: normalise engine results into rows"`

### Task 10: Composite cells and the Party scoreboard

**Files:**
- Create: `matbodh_dashboard/normalise/cells.py`
- Test: `tests/normalise/test_cells.py`

**Interfaces:**
- Consumes: `NormalRow` (Task 9).
- Produces:
  - `@dataclass(frozen=True) Cell(value: float | None, delta: float | None, trend: tuple[float | None, ...], secondary: str | None, flags: frozenset[str])`.
  - `@dataclass(frozen=True) ScoreboardRow(party: str, vote: Cell, seats_ac: Cell | None, seats_pc: Cell | None, gender_gap: Cell | None)`.
  - `build_scoreboard(rows: Sequence[NormalRow], *, round_ids: Sequence[str], anchor: str, compare: str | None, keep: Sequence[str], other_label: str, non_parties: Sequence[str] = ("Undecided", "NOTA")) -> list[ScoreboardRow]` — one row per party in keep ∪ {other_label} ∪ present non-parties ∪ any party with `seats_*` > 0 in any round; a seat-winning party outside `keep` takes its `vote` cell from `vote_share_bench`; non-parties get `seats_* = None` and flag `not_contender`; `trend` follows `round_ids`, with `None` + flag `not_asked` for missing rounds; `delta` is copied from `delta_*` rows only; gender cell `secondary = f"F {female:.1f} · M {male:.1f}"`.
  - `build_opinion_cells(rows, *, round_ids, anchor, compare) -> dict[str, Cell]` keyed by scenario — net score value/Δ/trend; `secondary = f"{positive:.0f} sat · {negative:.0f} dis"` for the anchor round.
  - `build_grid(rows, *, row_dim: str, round_ids, anchor, compare, measure: str = "support_share") -> dict[tuple[str, str], Cell]` keyed `(dimension value, series)` for the by-zone table.

- [ ] **Step 1: Write the failing tests** — `test_seat_winner_outside_keep_list_gets_own_row` (Review Focus 2: JDL 2 AC seats in o1, vote from `vote_share_bench`); `test_not_asked_round_is_flagged_not_zero` (Review Focus 1: trend `(None, 41.5)` with flag `not_asked`); `test_delta_comes_from_engine_rows_only` (Δ row 1.0 while shares differ by 0.5 → cell delta 1.0); `test_non_party_has_no_seat_cell`; `test_gender_secondary_text`; `test_grid_cells_by_zone`.
- [ ] **Step 2: Run** `pytest tests/normalise/test_cells.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** `cells.py`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: composite cells and party scoreboard"`

### Task 11: Presentation rules registry

**Files:**
- Create: `matbodh_dashboard/registry.py`, `config/presentation/global.yaml`, `config/presentation/uttar-pradesh.yaml`
- Test: `tests/test_registry.py`

**Interfaces:**
- Produces: `load_rules(dir: Path) -> RuleSet`; `RuleSet.order(field: str, values: Iterable[str], *, states: Sequence[str] = (), within: str | None = None) -> list[str]`; `RuleSet.hidden_count(field, values, *, states=()) -> int`; `RuleSet.label(field: str, value: str, state: str | None = None) -> str`; `RuleSet.colour(field: str, value: str) -> str | None`; `RuleSet.version: str` (hash of the rule files). Rule keys: `field`, `scope.state`, `within`, `order`, `pin_first`, `pin_last` (trailing `*` wildcard), `labels`, `hidden`, `colours`, `unknown ∈ {append_end, append_alpha}`.
- Seed: global `party` order `["NDA", "SP+", "BSP", "Other", "Undecided", "NOTA"]`, pin_last `["Other", "Undecided", "NOTA"]`, unknown `append_alpha`; UP `party_zone` order = the 15 zones from Appendix A, alphabetical (editable later).

- [ ] **Step 1: Write the failing tests** — `test_state_rule_overrides_global`; `test_unknown_values_appended_not_dropped` (`JDL` lands after BSP and before the pinned-last values); `test_wildcard_pin_last` (`"Other OBC"` matches `"Other *"`); `test_multi_state_merge` (global order first, state-only values appended in state order); `test_hidden_values_excluded_and_counted`; `test_version_changes_when_rule_changes`.
- [ ] **Step 2: Run** `pytest tests/test_registry.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** `registry.py` and the seed YAML.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: presentation rules registry"`

### Task 12: Cache, queue and card run service

**Files:**
- Create: `matbodh_dashboard/runner/cache.py`, `matbodh_dashboard/runner/queue.py`, `matbodh_dashboard/runner/service.py`, `matbodh_dashboard/runner/worker.py`
- Test: `tests/runner/test_service.py`

**Interfaces:**
- Consumes: Tasks 3–11.
- Produces:
  - `ResultCache(redis, ttl_seconds: int)`: `get(fp: str) -> dict | None`, `put(fp: str, result: dict) -> None`, `put_error(fp: str, error: EngineError) -> None`, `error(fp: str) -> dict | None`, `alliance_epoch() -> int`, `bump_epoch() -> int` (key `dash:alliance_epoch`).
  - `JobQueue` protocol: `submit(fp: str, config: dict) -> None`, `state(fp: str) -> Literal["queued", "running", "done", "failed"]`. `InlineQueue(runner: EngineRunner, cache: ResultCache)` executes synchronously; `RQQueue(redis, cache, queue_name: str = "engine")` enqueues `matbodh_dashboard.runner.worker.execute(fp, config)`.
  - `worker.execute(fp: str, config: dict) -> None` — one process-global `EngineRunner(build_runtime(settings.engine_env_file))`; stores the result or the classified error in the cache. Run with `rq worker engine`.
  - `CardRunService(catalogue: Catalogue, preset: MethodPreset, templates: dict[str, CardTemplate], rules: RuleSet, cache: ResultCache, queue: JobQueue, engine_version: str)`: `start(card_id: str, ctx: StateContext) -> str` (run id); `status(run_id: str) -> CardRunStatus(state: Literal["running", "done", "partial", "failed"], done: int, total: int, result: dict | None, errors: dict[str, dict])`; `refresh_metadata(catalogue: Catalogue) -> int` (replaces the catalogue and returns `bump_epoch()`).
  - Behaviour: jobs with `contenders_from` are submitted once their source job is done, via `bind_contenders` with the parties from its `support_share` rows; identical fingerprints are submitted once; `result` holds the cells (scoreboard / opinion / grid) ordered by `rules`, each series carrying its registry `label` and `colour`, plus `rounds` (labels, series groups, version, fallback, seat counts), `coverage` notes from the engine contract and `rules_version`.
  - Infrastructure errors retry up to 3 times with backoff (`rq.Retry(max=3, interval=[5, 15, 30])` in `RQQueue`; a loop in `InlineQueue`); `config` and `too_heavy` errors never retry.
  - Concurrency cap = number of `rq worker engine` processes (start with 4; documented in the README).
  - Every job logs one structured line: `fingerprint, card_id, part, state, queue_wait_s, engine_s, rows, cache_hit, error_kind, engine_version, metadata_revision` — no respondent data.

- [ ] **Step 1: Write the failing tests** (fakeredis, `InlineQueue`, fake runner returning fixture results) — `test_cache_hit_skips_runner`; `test_identical_jobs_deduplicated` (two cards sharing the vote job → runner called once for it); `test_epoch_bump_invalidates`; `test_contenders_bound_from_vote_job`; `test_failed_job_marks_only_its_parts` (Review Focus 5: PC job raises `ValueError` → state `partial`, `errors["seats_pc"]["kind"] == "config"`, vote and AC cells present); `test_infrastructure_error_retried_then_succeeds` (runner fails twice with `ConnectionError`, then succeeds → state `done`); `test_config_error_not_retried` (runner called once); `test_series_carry_label_and_colour`; `test_status_progress_counts`.
- [ ] **Step 2: Run** `pytest tests/runner/test_service.py -v` — Expected: FAIL.
- [ ] **Step 3: Implement** the four modules.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: cached, deduplicated card run service"`

### Task 13: HTTP API

**Files:**
- Create: `matbodh_dashboard/api/__init__.py`, `matbodh_dashboard/api/app.py`, `matbodh_dashboard/api/schemas.py`
- Test: `tests/api/test_app.py`

**Interfaces:**
- Consumes: `CardRunService`, `Catalogue`, `capabilities`, `validate_context`, `plan_card`.
- Produces `create_app(service: CardRunService) -> FastAPI` with:
  - `GET /catalogue/states` → `{"states": [...]}`
  - `GET /catalogue/{state}/surveys` → levels → series groups → rounds `{base_name, label, round, versions: {normal | extrapolated: {seats, borrowed, start_date, end_date}}}`
  - `GET /templates?section=pulse` → template list
  - `POST /cards/plan` body `{card_id, context}` → `{valid, errors, unavailable, rounds, coverage_mode}`; makes no engine calls; invalid context → 422 with the `validate_context` messages
  - `POST /cards/run` → `{run_id}`; `GET /runs/{run_id}` → `CardRunStatus`
  - `POST /admin/metadata/refreshed` → `{revision, alliance_epoch}`
  - every request copies an optional `X-Dashboard-User` header into `request.state.principal` (no-op until access control).

- [ ] **Step 1: Write the failing tests** (TestClient, service built on fakes) — `test_states_listed`; `test_surveys_grouped_by_level_and_series`; `test_plan_rejects_mixed_levels` (422 naming both rounds); `test_plan_reports_seats_unavailable_for_state_level`; `test_run_then_status_done`; `test_refresh_bumps_epoch`.
- [ ] **Step 2: Run** `pytest tests/api -v` — Expected: FAIL.
- [ ] **Step 3: Implement** `app.py` and `schemas.py`.
- [ ] **Step 4: Run** `pytest -q` (full suite) — Expected: all PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: dashboard HTTP API"`

### Task 14: Live read-only smoke check

**Files:**
- Create: `scripts/smoke_state_pulse.py`
- Modify: `README.md` (smoke-check section)

**Interfaces:**
- Consumes: the full stack with `InlineQueue` and a real `build_runtime`.

- [ ] **Step 1: Implement** `scripts/smoke_state_pulse.py --state "Uttar Pradesh" --rounds "2027 VS CAPI R1" "2027 VS CAPI R2"` — runs the scoreboard card through `CardRunService` synchronously and prints per-job timings, the scoreboard rows and any errors; read-only; not collected by pytest.
- [ ] **Step 2: Run** (manual, only with the product owner's go-ahead) the command above — Expected: rows BSP, NDA, Other, SP+, plus JDL in the seat columns; seat counts as in Appendix A (AC: NDA 243 → 154, SP+ 158 → 249; PC: NDA 49 → 26, SP+ 31 → 54); no errors.
- [ ] **Step 3: Document** in the README: prerequisites, the command, that it is read-only, and that timings are not acceptance thresholds.
- [ ] **Step 4: Commit** `git commit -m "docs: live read-only State Pulse smoke check"`
