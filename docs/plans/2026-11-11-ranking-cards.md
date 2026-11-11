# Ranking Cards (Seat and Demographic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `seat_ranking` and `demographic_ranking` cards that show engine rankings, with per-round rank pipes, master seat names and a kind-aware runner merge.

**Architecture:** A ranking card compiles to one engine job (standalone, compare) or one job per asked round (trend). Each job runs a `ranking` operation through the existing runner, queue and cache. `_assemble` hands the per-round results to a new `translate_ranked`, which builds a long-format `RankedPayload`. The frontend adds a ranked table inside a separate `RankingCard` shell that reuses the run hooks, `PipeCell` and the display-control conventions.

**Tech Stack:** Python 3.11+, pydantic, FastAPI, pytest; React 18, TypeScript, Mantine, vitest, Playwright. Engine: `matbodh_dash` / `matbodh_views` 0.8.0 in `../MatBodh-Dash`.

**Spec:** `docs/specs/2026-11-11-ranking-cards-design.md` (builds on `docs/specs/2026-11-10-card-foundation-and-grid-family-design.md`).

## Global Constraints

- The engine owns every number: Python and TypeScript never compute, re-rank, round, subtract or fill a rank, value, delta or total. A missing value is `—` with a reason, never `0`.
- Demographic ranking requires `top_k` 1–5 per partition (one named constant, `TOP_K_MAX = 5`). Seat ranking has no cap and `top_k` is optional.
- Modes are `standalone`, `compare` (rank of a delta metric) and `trend` (2–4 rounds, one scenario); they never combine. No "change in rank", no bottom-k, no ranking of seat groups by attribute.
- In a pipe the anchor round decides the rows and their order; later rounds are looked up for those entities.
- Absent-slot reasons are exactly `outside_top_k`, `not_ranked` and `round_failed`; never a zero.
- A failed non-anchor job gives a `partial` card; a failed anchor job fails the card.
- Seat names come from the engine row if it carries one (`seat_name`, `ac_name`, `pc_name`, `name`), else from an injected `SeatLabelProvider`; a lookup failure never fails the card.
- Dashboard observation ids are `o1..oN`; seat ranking rows have no `observation_id`, so a result's round comes from its job key (`rank` = the anchor or target round, `rank:<obs_id>`).
- Run `python -m pytest -q` (from this folder, with `.venv`) and `npx vitest run` + `npm run typecheck` (from `web/`). Skipped tests are not passes. Commit explicit paths only; never stage `docs/specs/2026-11-08-dashboard-design.md`, `.codegraph/`, `CLAUDE.md`, `prototypes/` or `uv.lock`.
- The live engine run (Task 11) needs the VPN and the product owner's go-ahead.

## Review Focus

1. **All ranks suppressed by the engine** (missing or zero-base metrics raise): the card shows the engine's message as the unavailable reason, never partial ranks. Pinned in Task 6.
2. **Ties push a partition past `top_k`**: rows beyond the requested k are kept as the engine returned them. Pinned in Task 2.
3. **Seat-name lookup fails** (master down, seat missing): the seat shows its number and the card still renders. Pinned in Task 4.
4. **Party metric without `party_id`, opinion metric with one, or a metric whose scenario kind does not match**: rejected at config time. Pinned in Task 1.
5. **Anchor entity missing from a later round** with and without `top_k`, and a later round whose job failed: each shows its own reason. Pinned in Tasks 2 and 6.

## File Structure

Backend (`matbodh_dashboard/cards/`):
- `rank_config.py` (new): `RankConfig`, `TOP_K_MAX`, metric tables.
- `config.py` (modify): families, `rank` field, validation.
- `families/seat_ranking.py`, `families/demographic_ranking.py` (new) and `families/__init__.py` (modify): `FamilySpec`s with no lenses.
- `ranking/payload.py` (new): `RankedPayload` and its parts.
- `ranking/translate.py` (new): `translate_ranked`, merge and absence logic.
- `ranking/labels.py` (new): `SeatLabelProvider`, `MasterSeatLabels`.
- `ranking/compile.py` (new): `compile_ranking_card`; `compile.py` delegates to it.
- `runner/service.py` (modify): ranking `_assemble` and anchor-failure rule; `bootstrap.py` (modify): label provider.
- `config/cards/cards.yaml` (modify): four seeded cards.

Frontend (`web/src/`): `api/types.ts` and `api/queries.ts` (modify); `cards/ranking/` (new: `rankedRows.ts`, `rankedCsv.ts`, `RankedTable.tsx`, `RankingCard.tsx`); `pages/CardsPage.tsx` (modify); `test/fixtures/cards/ranked_*.json` (generated).

Tests: `tests/cards/test_rank_config.py`, `test_ranking_translate.py`, `test_ranking_labels.py`, `test_ranking_compile.py`, `ranking_helpers.py`, additions to `tests/runner/test_service.py` and `tests/cards/test_field_coverage.py`.

---

### Task 1: Ranking config and family specs

**Files:**
- Create: `matbodh_dashboard/cards/rank_config.py`, `matbodh_dashboard/cards/families/seat_ranking.py`, `matbodh_dashboard/cards/families/demographic_ranking.py`, `tests/cards/test_rank_config.py`
- Modify: `matbodh_dashboard/cards/config.py`, `matbodh_dashboard/cards/families/__init__.py`

**Interfaces:**
- Produces: `TOP_K_MAX: int = 5`; `RankConfig(metric: Literal["support_share","net_score","positive_share","negative_share"], party_id: str | None, level: str, partition_by: list[str], filters: list[FilterSpec], top_k: int | None)`; `Family` extended with `"seat_ranking" | "demographic_ranking"`; `CardConfig.rank: RankConfig | None`; `RANKING_FAMILIES: frozenset[str]` in `config.py`; `SEAT_RANKING`, `DEMOGRAPHIC_RANKING: FamilySpec` registered in `FAMILIES` (empty `lenses`, `lens_sources`, `default_lens=""`, `Capabilities(modes=[standalone, compare, trend], transpose=False)`); `FamilySpec.scenario_kind` widened to `Literal["party","opinion","any"]`.

- [ ] **Step 1: Write failing tests** in `tests/cards/test_rank_config.py`, using a `make(**overrides)` helper like `test_config.py`'s (seat card: `family="seat_ranking"`, `scenarios=["pm_satisfaction"]`, `rank={"metric":"net_score","level":"ac"}`). Tests and assertions:
  - `test_seat_ranking_allows_no_top_k_and_any_top_k`: `make()` ok; `rank` with `top_k=50` ok.
  - `test_demographic_requires_top_k_one_to_five`: `level="caste"` with `top_k` missing, `0`, `6` each raise `ValueError` matching `"top_k"`; 1 and 5 ok.
  - `test_demographic_level_not_in_partition`: `level="caste", partition_by=["caste"]` raises `"distinct"`.
  - `test_seat_level_must_be_ac_or_pc`: `level="caste"` on a seat card raises `"ac or pc"`.
  - `test_party_metric_needs_party_id_and_opinion_forbids_it` (Review Focus 4): `support_share` with scenario `vs_voting_intention` and no `party_id` raises `"party_id"`; `net_score` with a `party_id` raises `"party_id"`; `net_score` on a party scenario raises `"does not match"`.
  - `test_ranking_card_needs_rank_block_and_grid_card_forbids_it`.
  - `test_compare_needs_distinct_endpoints_and_no_delta_measures`: compare with identical endpoints or `delta_measures=["net_score"]` raises.
  - `test_trend_needs_one_scenario`; `test_seat_ranking_rejects_card_level_filters_and_caste_clubbing`; `test_demographic_rejects_caste_clubbing_but_allows_filters`.
  - `test_ranking_families_are_registered`: `get_family("seat_ranking").lenses == ()` and `family_meta(...)` works.
- [ ] **Step 2: Run** `python -m pytest tests/cards/test_rank_config.py -q`. Expected: FAIL (import or validation errors).
- [ ] **Step 3: Implement** `RankConfig` in `rank_config.py` (strict model; `top_k: int | None = Field(default=None, ge=1)`); extend `Family`; add `rank` to `CardConfig`; in `CardConfig._validate` route ranking families to a new `_check_ranking()` and skip the grid-only `_check_family`/`_check_delta_measures` for them; metric-to-scenario-kind table `{"support_share": "party", others: "opinion"}` using the existing `scenario_kind`; Shakti compare allowed exactly as in the foundation (`comparison_kind`). Create the two `FamilySpec` modules and register them.
- [ ] **Step 4: Run** the new tests and the whole `tests/cards` folder. Expected: PASS, no regressions.
- [ ] **Step 5: Commit**
```bash
git add matbodh_dashboard/cards/rank_config.py matbodh_dashboard/cards/config.py matbodh_dashboard/cards/families tests/cards/test_rank_config.py
git commit -m "feat(cards): ranking families and RankConfig validation"
```

---

### Task 2: RankedPayload and seat translation

**Files:**
- Create: `matbodh_dashboard/cards/ranking/__init__.py`, `ranking/payload.py`, `ranking/translate.py`, `tests/cards/ranking_helpers.py`, `tests/cards/test_ranking_translate.py`; copy `result_rank.json`, `result_rank_complex.json`, `result_rank_comp.json`, `result_rank_filtd.json`, `result_seat_rank_demograph.json` from `../MatBodh-Dash/sample-output/` to `tests/fixtures/engine_samples/` (aggregates only).
- Test: `tests/cards/test_ranking_translate.py`

**Interfaces:**
- Consumes: `TranslateContext` and `row_key` from `cards/translate.py`; `CardConfig`.
- Produces (in `ranking/payload.py`): `RankedEntity(key: str, labels: dict[str, str | None])`; `RankedGroup(key: str, partition: dict[str, str | None], eligible_count: dict[str, int | None])`; `RankedValue(entity: str, group: str, round: str, rank: int | None, value: float | None, target_value: float | None, reference_value: float | None, target_base: float | None, reference_base: float | None, weighted_denominator: float | None, unweighted_base: float | None, status: str, flags: list[str])`; `AbsentSlot(entity: str, group: str, round: str, reason: Literal["outside_top_k","not_ranked","round_failed"])`; `RankedPayload(kind: Literal["ranked"], family, card_id, mode, state, rounds: dict, entity_kind: Literal["seat","demographic"], level: str, partition_by: list[str], top_k: int | None, direction: str | None, unit: str | None, groups, entities, ranks, absent, unavailable, not_asked, coverage, contracts: dict[str, dict], rules_version, engine_version, metadata_revision, alliance_epoch)`. `entities` are in display order: group, then anchor rank, then engine row order.
- Produces (in `ranking/translate.py`): `translate_ranked(card: CardConfig, results: Mapping[str, dict], ctx: TranslateContext, *, failed: Collection[str] = (), labels: SeatLabelProvider | None = None) -> RankedPayload`, where `results` and `failed` are keyed by **observation id** and `ctx.anchor` names the anchor. Task 4 defines `SeatLabelProvider`; until then `labels` is accepted and ignored.
- `ranking_helpers.py` produces `load_rank_sample(name) -> dict`, `ranked_ctx(card_id, obs_ids, anchor) -> TranslateContext`, and `variant(result, drop_seats=(), shift_rank=0) -> dict` (a clearly synthetic copy used for later-round fixtures, never presented as engine output).

- [ ] **Step 1: Write failing tests** on the samples (anchor `o2`):
  - `test_seat_standalone_maps_every_row`: `result_rank.json` → `entity_kind=="seat"`, 403 entities and 403 `ranks`, first entity `labels["seat_id"]=="128"`, its rank `1`, `value==54.987736154245084`, `unit=="percentage_points"`, `direction=="DESC"`, `status=="available"`, one group with `partition=={}` and `eligible_count=={"o2":403}`.
  - `test_partitions_become_groups`: `result_rank_complex.json` → a group `{"party_zone":"Big Leader Politics Belt"}` with `eligible_count["o2"]==32`; rank restarts per group; `reference_value` is carried unchanged for a compare card.
  - `test_every_number_comes_from_the_source`: property test — every non-null numeric in `ranks` is in the source row values.
  - `test_trend_rows_follow_the_anchor_and_look_up_later_rounds`: results `{"o2": sample, "o1": variant(sample, drop_seats=("128",))}` (trend, `o1` earlier) → entities are the anchor's, ordered by anchor rank; seat `128` has an `AbsentSlot(round="o1", reason="not_ranked")`; other seats have a `RankedValue` for both rounds.
  - `test_top_k_absence_reason`: same with `top_k=5` on the card → reason `outside_top_k`.
  - `test_failed_round_is_round_failed`: `failed={"o1"}` and no `o1` result → every entity has `AbsentSlot(round="o1", reason="round_failed")`.
  - `test_duplicate_entity_round_is_an_error` (merge never overwrites); `test_ties_keep_the_engines_rows` (Review Focus 2): a variant with three rows of rank 1 and `top_k=2` keeps all three.
- [ ] **Step 2: Run** `python -m pytest tests/cards/test_ranking_translate.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** payload models and `translate_ranked` for the seat path. Row fields map one-to-one (`metric_value`→`value`, `metric_status`→`status` with the foundation's `aligned`→`available`, null value→`null_value`); group key = `row_key` over the partition dict (`overall` when empty); contracts keyed by observation id.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add matbodh_dashboard/cards/ranking tests/cards/ranking_helpers.py tests/cards/test_ranking_translate.py tests/fixtures/engine_samples
git commit -m "feat(cards): RankedPayload and seat ranking translation"
```

---

### Task 3: Demographic translation and field coverage

**Files:**
- Modify: `matbodh_dashboard/cards/ranking/translate.py`, `tests/cards/test_ranking_translate.py`, `tests/cards/test_field_coverage.py`

**Interfaces:**
- Consumes: Task 2's `translate_ranked` and models.
- Produces: the demographic branch of `translate_ranked`: entity key `"<level>=<value>"`, entity `labels={level: value}`, group key from the `dimensions` of the partition fields, `observation_id` read from each row, ranks include `weighted_denominator` and `unweighted_base`.

- [ ] **Step 1: Write failing tests**:
  - `test_demographic_rows`: `result_seat_rank_demograph.json` with a demographic card (`level="caste"`, `partition_by=["ac_num"]`, `top_k=3`) → first group `{"ac_num":"1"}`; entity `caste=Other OBC` in it has rank `1`, `value==97.61311196810139`, `unweighted_base==44`, `weighted_denominator==0.03506076502559401`; every group has at most 3 distinct ranks.
  - `test_demographic_outside_top_k`: a variant of the same sample as an earlier round that omits one anchor entity → `AbsentSlot(reason="outside_top_k")`.
  - In `test_field_coverage.py` add `test_ranking_samples_have_no_unmapped_key`: for each of the five ranking samples every key of every row and of `contract` appears in an explicit `MAPPED_ROW_KEYS` / `MAPPED_CONTRACT_KEYS` set defined in the test (payload fields, or an explicit ignore list with a one-line reason each), so a new engine key fails the test.
- [ ] **Step 2: Run** `python -m pytest tests/cards -q -k "ranking or field_coverage"`. Expected: FAIL.
- [ ] **Step 3: Implement** the demographic branch; share the merge and absence core with the seat branch (no duplicated lookup logic).
- [ ] **Step 4: Run** `python -m pytest tests/cards -q`. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add matbodh_dashboard/cards/ranking/translate.py tests/cards
git commit -m "feat(cards): demographic ranking translation and field coverage"
```

---

### Task 4: Seat label provider

**Files:**
- Create: `matbodh_dashboard/cards/ranking/labels.py`, `tests/cards/test_ranking_labels.py`
- Modify: `matbodh_dashboard/cards/ranking/translate.py`, `matbodh_dashboard/bootstrap.py`, `matbodh_dashboard/runner/service.py` (constructor only)

**Interfaces:**
- Produces: `SeatLabelProvider` (Protocol): `labels(state: str, level: Literal["ac","pc"], seat_ids: Sequence[int]) -> dict[int, dict[str, str]]`; `MasterSeatLabels(access: MySQLAccess, revision: Callable[[], int])` implementing it by reading `access.seat_snapshot(state, level, ("ac_name" or "pc_name", "zone"))` and caching per `(state, level, revision())`, returning `{"name": ..., "zone": ...}` per seat; `CardRunService.__init__(..., seat_labels: SeatLabelProvider | None = None)`.
- Consumes: Task 2's `translate_ranked(..., labels=...)`.

- [ ] **Step 1: Write failing tests**:
  - `test_engine_row_name_wins_over_provider`: a seat row carrying `"seat_name": "Lucknow West"` and a provider returning another name → `entity.labels["name"]=="Lucknow West"`.
  - `test_provider_fills_names_and_zone`: fake provider → `labels["name"]` and `labels["zone"]` set; the provider is called once per `(level, seat ids)`.
  - `test_provider_failure_never_fails_the_card` (Review Focus 3): provider raises `RuntimeError` → payload builds, entities keep `seat_id` only; a missing seat id gets no name.
  - `test_master_labels_cache_follows_revision`: fake `access.seat_snapshot` with call counter; same revision → one call; changed revision → second call.
- [ ] **Step 2: Run** `python -m pytest tests/cards/test_ranking_labels.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the protocol, `MasterSeatLabels` and the precedence in `translate_ranked`; log only the exception type on failure. In `bootstrap.build_service_from_settings`, build `MasterSeatLabels` from the runtime's `MySQLAccess` and pass `seat_labels=` to the service.
- [ ] **Step 4: Run** `python -m pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add matbodh_dashboard/cards/ranking matbodh_dashboard/bootstrap.py matbodh_dashboard/runner/service.py tests/cards/test_ranking_labels.py
git commit -m "feat(cards): seat names from the master through an injected provider"
```

---

### Task 5: Compile ranking jobs

**Files:**
- Create: `matbodh_dashboard/cards/ranking/compile.py`, `tests/cards/test_ranking_compile.py`
- Modify: `matbodh_dashboard/cards/compile.py` (delegate at the top of `compile_card`)

**Interfaces:**
- Consumes: `build_request`, `comparison`, `view_config` (compiler/requests.py); `resolve_rounds`, `resolve_anchor`, `template_blockers`, `field_available`; Task 1's `RankConfig`.
- Produces: `compile_ranking_card(config: CardConfig, ctx: StateContext, catalogue: Catalogue, preset: MethodPreset) -> RunPlan`; job keys `rank` (standalone, compare) and `rank:<obs_id>` (trend), all `part="grid"`, `kind="analysis"`.

Job shape (all other request policy comes from `build_request`; `grouping_sets=[]`, `coverage_mode="independent"`, `caste_clubbing=None`):
- Seat: `ranking = {"id": card.id, "seat_level": level, "universe_snapshot": f"{level}_roster", "target": [obs, scenario] | None, "comparison_id": id | None, "measure": metric, "party_id": party_id, "seat_ids": [], "filters": rank.filters, "partition_by": rank.partition_by, "membership_snapshot": "ac_pc" if level == "pc" and the round's survey level == "ac" else None, "display_seat_ids": [], "top_k": rank.top_k}`; request `filters=[]`.
- Demographic: `ranking = {"id", "level", "target", "measure", "party_id", "partition_by", "top_k", "comparison_id"}`; request `filters` = the card's.
- Compare: one job, request carries the `comparison(...)` (kind from `comparison_kind`, as the foundation's `_comparisons`), `target` null, `comparison_id` its id; both endpoint rounds are in the request.

- [ ] **Step 1: Write failing tests** with the same catalogue and context helpers `test_compile.py` uses:
  - `test_standalone_seat_card_is_one_job`: one job keyed `rank`, request observations only the anchor round, ranking `seat_level=="ac"`, `universe_snapshot=="ac_roster"`, `top_k is None`.
  - `test_pc_from_an_ac_survey_adds_membership` and `test_pc_on_a_pc_survey_does_not`; `test_ac_ranks_on_a_pc_survey_are_unavailable` (reason mentions `AC`).
  - `test_trend_emits_one_job_per_asked_round`: three rounds, jobs `rank:o1`, `rank:o2`, `rank:o3`, each with one observation and identical policy and `top_k`; a round that did not ask the scenario is listed in `not_asked`, not in jobs.
  - `test_compare_is_one_job_with_the_engine_comparison`: one job, `comparison_id` set, `target is None`, request `comparisons` has one entry with both endpoints.
  - `test_demographic_ranking_shape`: `level`, `partition_by`, `top_k==3`, card filters in the request, no `seat_level`.
  - `test_unknown_party_metric_scenario_not_asked_is_unavailable`; every plan with an unavailable entry has no jobs.
- [ ] **Step 2: Run** `python -m pytest tests/cards/test_ranking_compile.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** `compile_ranking_card` and the delegation (`if config.family in RANKING_FAMILIES`). Reuse the foundation's round/field/availability checks; seat `filters` fields must exist as master attributes only at engine time (no catalogue check).
- [ ] **Step 4: Run** `python -m pytest tests/cards -q`. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add matbodh_dashboard/cards/ranking/compile.py matbodh_dashboard/cards/compile.py tests/cards/test_ranking_compile.py
git commit -m "feat(cards): compile ranking cards to one job per round for trends"
```

---

### Task 6: Runner assembly and failure rules

**Files:**
- Modify: `matbodh_dashboard/runner/service.py`, `tests/runner/test_service.py`

**Interfaces:**
- Consumes: Task 2/3's `translate_ranked`; Task 5's job keys; `CardRunService.seat_labels`.
- Produces: `_assemble` dispatches on `card.family`: ranking families build `results: dict[obs_id, dict]` from finished jobs (obs id parsed from the key suffix, or the plan anchor/target for key `rank`) and `failed` from failed jobs, then call `translate_ranked`; `_status` returns `failed` when the anchor's job failed and `partial` when only other jobs failed.

- [ ] **Step 1: Write failing tests** in `tests/runner/test_service.py` with the existing fake queue and runner patterns:
  - `test_ranking_standalone_runs_one_job_and_returns_a_ranked_payload` (`result["kind"]=="ranked"`).
  - `test_trend_non_anchor_failure_is_partial_and_refresh_reruns_only_it`: jobs `rank:o1` (fails with an infrastructure error) and `rank:o2`; state `partial`, `errors["grid"]["jobs"]==["rank:o1"]`, payload has `round_failed` slots; after the runner heals, a second `start` runs one engine call (the `o2` result is a cache hit).
  - `test_trend_anchor_failure_fails_the_card`: state `failed`, `result is None`.
  - `test_adding_a_round_runs_one_new_job`.
  - `test_engine_error_message_is_the_unavailable_reason` (Review Focus 1): the runner raises a `config` `EngineError("all ranks suppressed...")` for the only job → state `failed`, `errors["grid"]["message"]` equals the engine message and no payload.
- [ ] **Step 2: Run** `python -m pytest tests/runner/test_service.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the dispatch and the anchor rule in `_status`; leave grid families on their existing path untouched.
- [ ] **Step 4: Run** `python -m pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add matbodh_dashboard/runner/service.py tests/runner/test_service.py
git commit -m "feat(runner): assemble ranking payloads and apply the anchor failure rule"
```

---

### Task 7: Seeded cards and API listing

**Files:**
- Modify: `config/cards/cards.yaml`, `tests/cards/test_config.py` (seed test), `tests/api/test_app.py`

**Interfaces:**
- Produces: four cards from spec §12 using party id `NDA` (the preset's canonical alliance id and the one `docs/usage.md` documents for ranking): `ranking.ac_pm_net`, `ranking.ac_bjp_support_by_zone` (partition `party_zone`), `ranking.pc_pm_net`, `ranking.castes_by_ac_support` (demographic, `level: caste`, `partition_by: [ac_num]`, `top_k: 3`); all `section: rankings`.

- [ ] **Step 1: Write failing tests**: `test_seed_cards_load` expects the four new ids; `GET /cards` returns them with `family` and a `meta` whose `lenses == []`; `/cards/plan` for `ranking.ac_pm_net` returns `valid: true` against the existing test catalogue (R2 asks `pm_satisfaction`).
- [ ] **Step 2: Run** `python -m pytest tests/cards/test_config.py tests/api -q`. Expected: FAIL.
- [ ] **Step 3: Add** the four cards to `cards.yaml`.
- [ ] **Step 4: Run** `python -m pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add config/cards/cards.yaml tests/cards/test_config.py tests/api/test_app.py
git commit -m "feat(cards): seed four ranking cards"
```

---

### Task 8: Frontend types, run hook and fixtures

**Files:**
- Modify: `web/src/api/types.ts`, `web/src/api/queries.ts`, `web/src/cards/CardShell.tsx`, `scripts/export_card_fixtures.py`, `tests/cards/test_fixture_export.py`
- Create (generated): `web/src/test/fixtures/cards/ranked_seat_standalone.json`, `ranked_seat_trend.json`, `ranked_demographic_standalone.json`

**Interfaces:**
- Produces: TS mirrors of Task 2's models (`RankedPayload`, `RankedEntity`, `RankedGroup`, `RankedValue`, `AbsentSlot`); `Family` extended; `type CardPayload = GridPayload | RankedPayload`; `isRankedPayload(p: CardPayload): p is RankedPayload` (checks `kind === "ranked"`); `RunStatus.result: CardPayload | null`; `useCardRun<P extends CardPayload = GridPayload>(...)` returning `CardRun<P>` so `CardShell` keeps its grid typing.

- [ ] **Step 1: Write failing tests**: `types.test.ts` asserts `isRankedPayload` on a ranked fixture and not on a grid one; `tests/cards/test_fixture_export.py` asserts the three new fixture names are exported and every one validates against `RankedPayload` (trend fixture built with the synthetic `variant` helper, labelled `synthetic_later_round` in its provenance).
- [ ] **Step 2: Run** `python -m pytest tests/cards/test_fixture_export.py -q` and `cd web && npx vitest run src/api`. Expected: FAIL.
- [ ] **Step 3: Implement** the types, guard and generic hook; extend `export_card_fixtures.py` with a ranked branch; run it to write the fixtures; adjust `CardShell` only as the generic default requires.
- [ ] **Step 4: Run** `python -m pytest -q`, `cd web && npx vitest run && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add web/src/api web/src/cards/CardShell.tsx scripts/export_card_fixtures.py tests/cards/test_fixture_export.py web/src/test/fixtures/cards
git commit -m "feat(web): ranked payload types, generic run hook and ranked fixtures"
```

---

### Task 9: Ranked rows model (pure)

**Files:**
- Create: `web/src/cards/ranking/rankedRows.ts`, `rankedRows.test.ts`, `rankedCsv.ts`, `rankedCsv.test.ts`

**Interfaces:**
- Consumes: `RankedPayload`.
- Produces: `type RankedSlot = { kind: "ranked"; round: string; rank: number | null; value: number | null; status: string; flags: string[] } | { kind: "absent"; round: string; reason: AbsentSlot["reason"] }`; `interface RankedRowModel { key: string; entity: RankedEntity; group: RankedGroup; slots: RankedSlot[] }`; `interface RankedView { sort: { round: string; by: "rank" | "value"; dir: "asc" | "desc" } | null; search: string; density: Density; showDetails: boolean }`; `rankedRows(p: RankedPayload, view: RankedView): { groups: { group: RankedGroup; rows: RankedRowModel[] }[]; rounds: string[] }` (slots in `p.rounds.items` order, restricted to the rounds present); `rankedToCsv(model): string`; `initialRankedView(p): RankedView`; `tieKeys(rows): Set<string>` (rows sharing a rank in the anchor round).

- [ ] **Step 1: Write failing tests** from `ranked_seat_trend.json` and `ranked_demographic_standalone.json`: default order equals the payload's entity order (anchor rank); sort by a later round's rank reorders rows but not their slots, nulls last; search matches seat id, name and level value; absent slots keep their reason; `tieKeys` marks two rows sharing a rank; a rank slot is never computed (the model's numbers equal the payload's); CSV has one column pair per round and a reason text for absent slots, never `0`.
- [ ] **Step 2: Run** `cd web && npx vitest run src/cards/ranking`. Expected: FAIL.
- [ ] **Step 3: Implement** the pure functions; no React, no fetch.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add web/src/cards/ranking
git commit -m "feat(web): pure ranked rows model with sort, search and csv"
```

---

### Task 10: RankedTable, RankingCard and CardsPage

**Files:**
- Create: `web/src/cards/ranking/RankedTable.tsx`, `RankedTable.test.tsx`, `RankingCard.tsx`, `RankingCard.test.tsx`
- Modify: `web/src/pages/CardsPage.tsx`, `web/src/pages/CardsPage.test.tsx`

**Interfaces:**
- Consumes: Task 8's `useCardPlan`, `useCardRun<RankedPayload>`; Task 9's model; `PipeCell` (values only), `PopoverChip`, `MethodDrawer`, `CardFooter`-style coverage notes from `cards/coverage.ts`.
- Produces: `RankedTable({ model, payload, view, onView })` (header shows the engine unit and direction; group headers for partitions; seat rows show the name beside the id when present; rank and value pipes per round; a tie marker; absent slots as `—` with a reason title and accessible label; "Show 100 more" progressive cap as the foundation); `RankingCard({ info, ctx })` (same states as `CardShell`: checking, running, partial alert, blocked reasons, error with Refresh; controls Sort, Search, Density, Details, Export CSV, Method; never fetches on a control change); `CardsPage` renders `RankingCard` when `info.family` is `seat_ranking` or `demographic_ranking`, else `CardShell`.

- [ ] **Step 1: Write failing tests** (vitest + testing-library, API mocked like `CardShell.test.tsx`): the seat card renders 403 rows capped to 100 with "Show 100 more"; a trend fixture shows `15 | 18`-style rank pipes in round order and a dash with the title `outside top 3 in …` for `outside_top_k`; Sort by a later round reorders rows; no API call after any control change (assert call count); a partial run shows "Some parts failed" and `round_failed` slots; `CardsPage` renders one `RankingCard` and one `CardShell` for mixed families.
- [ ] **Step 2: Run** `cd web && npx vitest run src/cards/ranking src/pages`. Expected: FAIL.
- [ ] **Step 3: Implement** the components with the foundation's tokens, focus and keyboard conventions; rank pipes use a small local `RankPipe` (integers), values use `PipeCell` with the payload `unit` mapped as the foundation's grid does.
- [ ] **Step 4: Run** `cd web && npx vitest run && npm run typecheck && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add web/src/cards/ranking web/src/pages
git commit -m "feat(web): ranked table and ranking card"
```

---

### Task 11: e2e, docs, spec corrections and live check

**Files:**
- Modify: `web/e2e/cards.spec.ts`, `docs/README.md`, `docs/testing.md`, `docs/specs/2026-11-11-ranking-cards-design.md`, `scripts/smoke_card.py` (only if it needs ranking-aware reporting)

- [ ] **Step 1: e2e** — extend the existing `serve(page)` fixture map in `cards.spec.ts` with `ranked_seat_trend` and `ranked_demographic_standalone` and add one test: both ranking cards render with their titles and rank pipes, keyboard Sort works, and `calls` has no request after the control change. Run `cd web && npm run e2e`. Expected: PASS (needs installed Chrome and port 4173 free).
- [ ] **Step 2: Docs** — update `docs/README.md` (new families, cards, label provider) and `docs/testing.md` (ranking tests, fixtures, the synthetic later-round helper); correct the spec: `BJP+` → `NDA` in §12 with the reason, add `round_failed` to §3, §5.3 and §6, and link this plan in the header table.
- [ ] **Step 3: Full verification** — `python -m pytest -q`, `cd web && npx vitest run && npm run typecheck && npm run build`. Expected: all pass, no skips attributable to this work.
- [ ] **Step 4: Live check (only with the product owner's go-ahead and the VPN)** — for each seeded card run `python scripts/smoke_card.py --card <id> --state "Uttar Pradesh" --rounds "2027 VS CAPI R1" "2027 VS CAPI R2"` with `ENGINE_ENV_FILE` set as in `docs/testing.md`; expected `state=done`, jobs `1/1` (standalone cards), exit 0. Record state, job counts and timings in `docs/testing.md`. If `party_id: NDA` is rejected by the engine, stop and report the error text; do not guess another id. Also run one trend config across R1 and R2 and record that it ran two jobs.
- [ ] **Step 5: Commit**
```bash
git add web/e2e docs/README.md docs/testing.md docs/specs/2026-11-11-ranking-cards-design.md
git commit -m "docs: ranking cards e2e, documentation and live check"
```

---

## Self-review notes

- **Spec coverage:** §3 rules → Tasks 1, 2, 3; §4 config → Task 1; §5 jobs and merge → Tasks 5, 6; §5.3 absences → Tasks 2, 3, 6; §6 payload → Task 2; §6.1 labels → Task 4; §7 frontend → Tasks 8–10; §8 samples → Task 2; §9 tests → each task; §10 open items 1–4 resolved in the spec, item 1 re-checked live in Task 11; §12 cards → Task 7; §13 acceptance → Task 11 verification.
- **Spec changes this plan requires:** the absent reason `round_failed` (spec §5.1 already says non-anchor failures show dashes but names only two reasons), and the party id `NDA` for the seeded party cards (spec §12 said `BJP+` pending a plan-time check against the preset; the preset and `docs/usage.md` use `NDA`). Task 11 applies both.
- **Known limits:** trend fixtures for later rounds are synthetic (only R2 ranking samples exist); demographic compare is verified by unit tests only; no PC live run beyond the 2026-11-11 CLI check until Task 11.
