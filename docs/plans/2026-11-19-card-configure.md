# Card Configure (sub-project 6a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analysts add a card, pick its type and configure every engine input in place, with options shown only when they apply, option lists from real metadata, one backend rulebook, and cards that run from their own config.

**Architecture:** The backend publishes a per-family configure descriptor (fields, widget kind, required, show-when condition, option source), option-list endpoints, and `POST /cards/validate`; plan/run/preview accept an inline `CardConfig`. The frontend renders any descriptor with one generic renderer over a small set of widgets, edits a draft, validates on change and runs on Apply. Configured cards live in a per-state browser list until the canvas (6b) and saving (6c).

**Tech Stack:** Python 3.10+, FastAPI, Pydantic v2, pytest + fakeredis; React 18, TypeScript strict, Mantine 7, TanStack Query v5, Vitest, Playwright (stubbed API).

**Spec:** `docs/specs/2026-11-19-card-configure-design.md` (read it with this plan).

## Global Constraints

- The engine owns every number; NULL is never zero; read-only database access; series-qualified round labels; one `formatPercent` (dashboard `CLAUDE.md`).
- Method policy stays in the preset; the only analyst-chosen weighting is relationship joint weight from a scenario, whose `mode` is `preset.weights.mode`.
- Party scenarios without embedded weights stay excluded (`party_scenarios_of`, Q-11).
- Inline-card limits: at most 12 scenarios, 8 cuts, 8 filters, 200 values per filter, 200-character title.
- Client card ids and titles never enter the engine config or fingerprint.
- Seat segmentation (seat type/score: `ac_type`, `ac_score`, `pc_type`, `pc_score`) is out of scope (owner, 2026-11-19): these fields are never offered in option lists, and no segmentation config, preset key or election flag is added.
- Commit explicit paths only. Never commit `docs/specs/2026-11-08-dashboard-design.md`, `.codegraph/`, `CLAUDE.md`, `prototypes/`, `uv.lock`.
- Every change that opens, closes or decides an item updates `docs/open-items.md` in the same commit; never delete rows.
- Backend tests: `.venv/Scripts/python.exe -m pytest -q` from `matbodh-dashboard/`. Frontend: `cd web && npx vitest run`, `npm run typecheck`, `npm run build`, `npm run e2e`.
- Live checks only with the owner's go-ahead (VPN).

## Spec amendments made by this plan (record in the spec in Task 14)

- 7.3 filter values: instead of a new engine helper, the dashboard runs an ordinary engine distribution job with `grouping_sets: [[field]]` over the rounds read and lists the returned dimension values. The engine applies reporting mapping, FINAL, final_valid and readiness; no engine change. Values are those present among respondents eligible for the job's scenario (the card's first scenario, else the anchor round's first `party_scenarios_of`), which are the only values that can affect that card.
- 5.9 seat segmentation: dropped from 6a entirely (owner, 2026-11-19); to be designed later. Note for that work: segmentation data lives in `acDashboard_retrosegement`, not `config/elections.yaml`.

## Review Focus

1. A saved card whose context changes (fewer pipe rounds, anchor moved) — expect the window to shrink with a note, never an error. Test: Task 2 `test_window_after_round_dropped_from_context`.
2. A draft that keeps a value no longer offered (filter value absent from the new rounds) — expect it flagged on its field, not silently dropped. Test: Task 12 FilterList `flags a chosen value missing from the current rounds`.
3. A hidden field's stale value surviving into a saved card (switch compare → standalone, reference endpoint lingers) — expect pruning before validate and save. Test: Task 11 `prunes values of fields hidden by their condition`.
4. A large or hostile inline card (thousands of filter values, unknown keys) — expect 422 with a clear message, no engine job. Test: Task 4 `test_inline_card_limits_rejected`.
5. Browser storage unavailable (private window, quota) — expect the page to work for the session with an in-memory list. Test: Task 13 `falls back to memory when localStorage throws`.

---

### Task 1: `CardConfig` and preset additions

**Files:**
- Modify: `matbodh_dashboard/cards/config.py`
- Test: `tests/cards/test_config_configure.py`

**Interfaces:**
- Produces:
  - `CardConfig.pipe_rounds: int | None = Field(default=None, ge=1)`
  - `CardConfig.display_parties: list[str] = []` (`distribution` and `gender_differential` only: party rows)
  - `CardConfig.section: str = "cards"` (now optional)
  - `CardConfig.requires` keeps its default `state` and is not shown in configure; the compilers already check seat levels (`ac` would block PC surveys, `capability.py:34,42`)
  - `BenchmarkConfig.reference: BenchmarkReference | None = None`, `.contenders: list[str] | None = None`
  - `JointWeight(_Strict)`: `source: Literal["base","scenario"] = "base"`, `scenario: str | None = None`; `RelationshipConfig.joint_weight: JointWeight = JointWeight()`
  - `SEGMENT_FIELDS = frozenset({"ac_type","ac_score","pc_type","pc_score"})` — used only to keep them out of option lists (Task 7)
  - `_fail(path: str, message: str) -> NoReturn` raising `ValueError(f"@{path}: {message}")`; every raise in `CardConfig` validators goes through it with the most specific path (`""` for the card)

- [ ] **Step 1: Write failing tests** in `tests/cards/test_config_configure.py`:
  - `test_pipe_rounds_must_be_positive` — `pipe_rounds=0` raises.
  - `test_section_optional` — a card without `section` gets `section == "cards"`; a PC seat ranking without `requires` compiles on a PC-level survey.
  - `test_display_parties_party_rows_only` — on `seat_ranking` and on `opinion` raises with `@display_parties:`.
  - `test_benchmark_contenders_rules` — contenders not containing `focal_party` raises `@benchmark.contenders:`; duplicate contenders raise.
  - `test_joint_weight_scenario_rules` — `source="scenario"` without scenario raises `@relationship.joint_weight.scenario:`; with `source="base"` and a scenario raises; a recalled scenario (`vs_past`) raises (needs embedded weights).
  - `test_errors_carry_paths` — `trend` with two scenarios raises a message starting `@scenarios:`.
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/cards/test_config_configure.py -q` — expect FAIL.
- [ ] **Step 3: Implement** the fields and rules above; convert existing raises to `_fail` (messages unchanged after the prefix, so existing `match=` tests keep passing). `JointWeight` scenario check uses the scenario catalogue: kind party and `weight_keys` non-empty.
- [ ] **Step 4: Run** the full backend suite — expect PASS.
- [ ] **Step 5: Commit** `git add matbodh_dashboard/cards/config.py tests/cards/test_config_configure.py` then `git commit -m "feat: card config fields for configure (pipe rounds, hide parties, contenders, joint weight)"`

### Task 2: Pipe-round window

**Files:**
- Modify: `matbodh_dashboard/compiler/rounds.py`, `matbodh_dashboard/compiler/plan.py` (`RunPlan.notes: tuple[str, ...] = ()`), `matbodh_dashboard/cards/compile.py` (`_select` trend branch, `plan()` notes), `matbodh_dashboard/cards/ranking/compile.py` (notes passthrough), `matbodh_dashboard/cards/relationship/compile.py` (`used` rounds), `matbodh_dashboard/api/app.py` (`/cards/plan` returns `notes`)
- Test: `tests/compiler/test_rounds.py`, `tests/cards/test_compile.py`, `tests/cards/test_relationship_compile.py`

**Interfaces:**
- Consumes: `CardConfig.pipe_rounds` (Task 1)
- Produces: `pipe_window(rounds: Sequence[ResolvedRound], anchor: str, count: int | None) -> tuple[list[ResolvedRound], str | None]` — `None` returns `list(rounds)` unchanged (today's behaviour); otherwise rounds with `sort_key <= anchor's`, last `count`, and the note `f"showing {k} of the {count} rounds asked for"` when fewer than `count` exist.
- `RunPlan.rounds` for a windowed trend/relationship card is the **window**, not every context round: `rounds_block` and `round_order` (`runner/service.py:332-333`) and `payloadToGrid.ts:50` draw every listed round, so out-of-window rounds would show as empty points.

- [ ] **Step 1: Failing tests** in `tests/compiler/test_rounds.py` with four resolved rounds R1..R4 (anchor R4):
  - `test_window_none_keeps_all`; `test_window_last_three` → `[R2,R3,R4]`, note `None`;
  - `test_window_after_round_dropped_from_context` — context R1,R3,R4, count 3 → `[R1,R3,R4]`;
  - `test_window_new_anchor_moves_forward` — R1..R5, anchor R5, count 3 → `[R3,R4,R5]`;
  - `test_window_short_notes` — two rounds, count 3 → both, note `"showing 2 of the 3 rounds asked for"`;
  - `test_window_excludes_rounds_after_anchor` — anchor R3 of R1..R4, count 2 → `[R2,R3]`.
  In `tests/cards/test_compile.py`: `test_trend_pipe_rounds_window_then_not_asked` — count 3 over R1..R4 where R3 did not ask the scenario → jobs read `[R2,R4]`, `not_asked` lists R3, `notes` empty; `test_trend_window_above_max_is_unavailable` keeps today's message. In `tests/cards/test_relationship_compile.py`: `test_relationship_pipe_rounds_window`. In `tests/runner/test_service.py`: `test_windowed_trend_payload_lists_only_window_rounds` — count 2 over R1..R4 → payload `rounds.items` obs ids are R3, R4 only (also for a ranking trend).
- [ ] **Step 2: Run** those files — expect FAIL.
- [ ] **Step 3: Implement** `pipe_window`; apply it first in the grid `_select` trend branch (so ranking trend inherits it) and to relationship `rounds` before the asked filter; build `RunPlan` with `rounds=` the window for those cards; carry the note into `RunPlan.notes`; `/cards/plan` adds `"notes": list(run_plan.notes)`.
- [ ] **Step 4: Run** the full backend suite — PASS.
- [ ] **Step 5: Commit** the files above: `git commit -m "feat: per-card pipe-round count (last N up to the anchor)"`

### Task 3: Compile the new capabilities

**Files:**
- Modify: `matbodh_dashboard/compiler/requests.py` (`build_request(..., display_parties: Sequence[str] = ())`), `matbodh_dashboard/cards/compile.py` (grid: check and emit `display_parties`), `matbodh_dashboard/cards/ranking/compile.py` (ranking operation `"id": "ranking"`, a constant, replacing `config.id` at line 40 — the card id otherwise reaches the fingerprint, also through cohort selection at `cards/cohort/compile.py:103`), `matbodh_dashboard/cards/benchmark/compile.py` (config reference fallback, contenders), `matbodh_dashboard/cards/relationship/compile.py` (joint weight)
- Test: `tests/compiler/test_requests.py`, `tests/compiler/test_fingerprint.py`, `tests/cards/test_compile.py`, `tests/cards/test_benchmark_compile.py`, `tests/cards/test_relationship_compile.py`

**Interfaces:**
- Consumes: Task 1 fields; `MajorPartyProvider.identities`.
- Produces: engine configs as below (the fingerprint inputs).

- [ ] **Step 1: Failing tests** (fixtures use a fake `MajorPartyProvider` returning `{"NDA","SP+","BSP"}`):
  - `test_display_parties_emitted` — distribution with `display_parties=["NDA","Other"]` → `request["display_parties"] == ["NDA","Other"]`; `test_display_parties_unknown_party_unavailable` — `["XYZ"]` (not in `preset.keep` + `preset.other_label`) → unavailable naming `XYZ`; no alliance lookup happens.
  - `test_benchmark_reference_from_config` — no request reference + `benchmark.reference=election 2022 VS` → reference endpoint is the election; a request reference still wins.
  - `test_benchmark_contenders_subset` — `contenders=["NDA","SP+"]` → `benchmark["contenders"] == ["NDA","SP+"]` and `request.parties.other_grouping.keep == ["BSP","NDA","SP+"]` (all majors); contender not a major → unavailable.
  - `test_relationship_joint_weight_scenario` — `{"source":"scenario","scenario":"vs_voting_intention"}` → `weights == {"source":"scenario","scenario":"vs_voting_intention","mode":"mj_cap"}`; scenario missing in a used round → unavailable; default stays `{"source":"base"}`.
  - `test_fingerprint_ignores_card_id_and_title` (`tests/compiler/test_fingerprint.py`) — for one card of **each family** (distribution, seat ranking, demographic ranking, benchmark, relationship) and for a cohort preview of a seat ranking, two configs differing only in id/title compile to equal fingerprints.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Benchmark `ref = reference or config.benchmark.reference or default_reference(ctx)`.
- [ ] **Step 4: Run** the full suite — PASS.
- [ ] **Step 5: Commit** the files above: `git commit -m "feat: compile hide parties, contenders, config reference and joint weights"`

### Task 4: Run a card from its own config

**Files:**
- Modify: `matbodh_dashboard/api/schemas.py`, `matbodh_dashboard/api/app.py`, `matbodh_dashboard/runner/service.py`
- Test: `tests/api/test_inline_card_api.py`, `tests/runner/test_service.py`, `tests/api/test_cohort_preview_api.py`

**Interfaces:**
- Produces:
  - `CardRequest` / `PreviewRequest`: `card_id: str | None = None`, `card: CardConfig | None = None`; model validator: exactly one; `card` passes `check_inline_limits(card) -> None` (limits in Global Constraints).
  - `CardRunService.resolve(card_id: str | None, card: CardConfig | None) -> CardConfig` (KeyError for an unknown id); `plan`, `start`, `start_selection` take a `CardConfig` instead of an id (callers resolve first). `_Run.card_id` = `card.id`.
  - API returns 404 for an unknown `card_id`, 422 for a bad inline card.

- [ ] **Step 1: Failing tests** in `tests/api/test_inline_card_api.py` (pattern: `tests/api/test_app.py` fakes):
  - `test_plan_inline_card`, `test_run_inline_card_returns_run_id`, `test_preview_inline_card`;
  - `test_both_or_neither_rejected` (422 each);
  - `test_inline_card_limits_rejected` — 201 filter values → 422 naming the limit, and the queue received no job;
  - `test_unknown_card_id_404`;
  - `test_same_inline_card_two_clients_share_fingerprint` — two runs with different `id` and `title`, same config → one queue submission.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; update existing callers (`scripts/smoke_card.py`, tests) to pass the resolved card.
- [ ] **Step 4: Run** the full suite — PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat: plan, run and preview a card from an inline config"`

### Task 5: `POST /cards/validate`

**Files:**
- Create: `matbodh_dashboard/cards/configure/__init__.py`, `matbodh_dashboard/cards/configure/validate.py`
- Modify: `matbodh_dashboard/api/app.py`, `matbodh_dashboard/api/schemas.py` (`ValidateRequest {card: dict, context: StateContext}`)
- Test: `tests/api/test_validate_api.py`

**Interfaces:**
- Consumes: `_fail` prefix (Task 1); `service.plan` (Task 4).
- Produces: `validate_draft(draft: dict, ctx: StateContext, service: CardRunService) -> dict` returning `{"valid": bool, "errors": [{"path": str, "message": str}], "unavailable": [{"reason": str}], "not_asked": [...], "notes": [...], "rounds": [...]}`. Pydantic field errors → `".".join(loc)`; `@path: msg` → that path; others → `""`. Plan runs only when the model is valid; `valid` is true only with no errors and no unavailable.

- [ ] **Step 1: Failing tests:** `test_field_error_path` (`rank.top_k: 9` → path `rank.top_k`); `test_validator_error_path` (trend with two scenarios → path `scenarios`); `test_unavailable_reason` (scenario not asked in anchor → `valid false`, reason text names the round); `test_field_missing_in_read_round_unavailable` (a cut field absent from a read round → unavailable reason naming the field and round); `test_valid_draft` (`valid true`, `rounds` listed); `test_validate_never_queues_jobs`.
- [ ] **Step 2–4:** run (FAIL), implement, run full suite (PASS).
- [ ] **Step 5: Commit**: `git commit -m "feat: validate a draft card against CardConfig and the engine plan"`

Note for the implementer: a stale *filter value* is flagged by the frontend against the filter-values list (Task 12) and by the engine at run; the backend has no value list to check against without a run.

### Task 6: Descriptors, condition vocabulary, `GET /configure/families`

**Files:**
- Create: `matbodh_dashboard/cards/configure/descriptor.py` (models), `matbodh_dashboard/cards/configure/families.py` (one descriptor per family)
- Modify: `matbodh_dashboard/api/app.py`
- Test: `tests/cards/test_configure_descriptors.py`

**Interfaces:**
- Produces (pydantic, `extra="forbid"`):
  - `Condition` = tagged union on `op`: `equals{path,value}`, `in{path,values}`, `nonempty{path}`, `contains{path,value}`, `kind_of{path,kind: party|opinion|recalled}`, `count_at_least{path,n}`, `all{of: list[Condition]}`, `any{of}`, `not{of: Condition}`. Kinds follow `scenario_kind`: a recalled scenario is a **party** scenario with `recalled: true`, so `kind_of party` matches it and `kind_of recalled` matches only recalled ones (otherwise a ranking on `vs_past` would hide `party_id` that the validator requires).
  - `Widget = Literal["scenario_picker","metric_picker","cut_builder","filter_list","party_picker","election_picker","number","toggle","choice","text","slot"]`
  - `OptionSource(_Strict)`: `source: str`, `params: dict[str, str | int | bool] = {}`
  - `FieldDescriptor(_Strict)`: `path, label, help: str | None, widget, required: bool, tier: Literal["primary","more"], show_when: Condition | None, options: OptionSource | None, choices: list[str] | None, default: object | None, limits: dict[str, int] = {}, multiple: bool = False`
  - `FamilyDescriptor(_Strict)`: `family, label, description, fields: list[FieldDescriptor], meta: FamilyMeta`
  - `DISPLAY_OR_GENERATED: frozenset[str]` — `id`, `section`, `requires`, `view`, `all_party_scenarios` handled as a toggle field.
  - `descriptors() -> list[FamilyDescriptor]`; `GET /configure/families` returns them.
- Descriptor content per family follows spec sections 5.1–5.9 and the normative show-when examples in 6.3; primary tier = scenario/metric, cuts or level, mode (and seat level, origin/destination where the family has them).

- [ ] **Step 1: Failing tests:**
  - `test_every_config_field_has_descriptor_or_is_exempt` — for each family, every `CardConfig` leaf path the family accepts appears in its descriptor or `DISPLAY_OR_GENERATED`; every descriptor path resolves on `CardConfig`.
  - `test_required_fields_are_primary` — every `required` field has `tier == "primary"`, and every optional field is `more` unless the family lists it in its primary set (mode).
  - `test_normative_conditions` — caste clubbing has `contains{cuts,"caste"}`; relationship origin include-recalled has `kind_of{relationship.origin,recalled}`; delta measure shows only for opinion-to-opinion compare.
  - `test_families_endpoint` — 7 descriptors, each with `meta`.
- [ ] **Step 2–4:** run (FAIL), implement, run full suite (PASS).
- [ ] **Step 5: Commit**: `git commit -m "feat: configure descriptors for every card family"`

### Task 7: Option sources from the catalogue and lookups

**Files:**
- Create: `matbodh_dashboard/cards/configure/options.py`
- Modify: `matbodh_dashboard/api/app.py` (`POST /configure/options` with body `OptionsRequest {source: str, params: dict, card: dict, context: StateContext}`; context validated with `validate_context`). The draft card is sent so the backend computes the **rounds read** with the same selection the compilers use (mode, `pipe_rounds`, chosen scenarios, benchmark reference) — never guessed as "all context rounds" or "anchor only".
- Test: `tests/cards/test_configure_options.py`, `tests/api/test_options_api.py`

**Interfaces:**
- Produces: `OptionItem(_Strict)`: `value: str`, `label: str`, `kind: str | None`, `recalled: bool = False`, `disabled_reason: str | None`; `rounds_read(draft: dict, ctx: StateContext, catalogue) -> list[ResolvedRound]` (anchor for standalone, target+reference rounds for compare, `pipe_window` for trend/relationship, anchor+compare round for a benchmark with a compare reference; a draft too incomplete to tell → anchor plus a `disabled_reason` hint only where it matters); `options_for(source: str, params: dict, draft: dict, ctx: StateContext, service) -> list[OptionItem]` for sources `scenarios` (`kind`, `scope=anchor|all_read`), `metrics` (`scenario`), `fields` (`use=cut|filter|level|partition|seat_attribute`, `family`), `joint_weight_scenarios`, `parties` (`use=focal|contenders|hide|rank`), `elections` (benchmark reference). Unknown source → 404.

- [ ] **Step 1: Failing tests** on `tests/fixtures/catalogue_rows.py` catalogues:
  - `test_party_scenarios_follow_q11` — `cm_choice_party` absent, `vs_past` present with `kind == "recalled"`.
  - `test_scenario_not_in_every_round_disabled_for_all_read` — present in anchor only → `disabled_reason` names the missing round.
  - `test_fields_respect_capabilities` — PC-level survey: `ac_num` absent from cuts; gender absent for `family=gender_differential`.
  - `test_seat_attributes_exclude_seat_type` — `ac_type`, `ac_score`, `pc_type`, `pc_score` never listed for any `use`.
  - `test_joint_weight_scenarios_need_embedded_weights_in_every_round`.
  - `test_parties_hide_is_preset_keep_plus_other` (grid rows are `preset.keep` + Other, `compiler/requests.py:93`; no alliance lookup); `test_parties_rank_is_preset_keep`; `test_parties_focal_benchmark_depends_on_reference` (election reference → that election's mapping).
  - `test_rounds_read_follows_mode_and_window` — standalone → anchor; compare → both endpoint rounds; trend with `pipe_rounds: 2` → last two; a field present in the anchor but missing in a windowed round is disabled with that round named.
- [ ] **Step 2–4:** run (FAIL), implement, run full suite (PASS).
- [ ] **Step 5: Commit**: `git commit -m "feat: configure option lists from the catalogue, alliance mapping and elections"`

### Task 8: Filter values through an engine distribution job

**Files:**
- Create: `matbodh_dashboard/cards/configure/values.py`
- Modify: `matbodh_dashboard/runner/service.py` (`start_values`, `_Run.values: bool`, `_assemble` branch), `matbodh_dashboard/api/schemas.py` (`ValuesRequest {field: str, scenario: str | None, context: StateContext, pipe_rounds: int | None}`), `matbodh_dashboard/api/app.py` (`POST /configure/values` → `RunStarted`; results read via `/runs/{id}`)
- Test: `tests/cards/test_configure_values.py`, `tests/runner/test_values_run.py`

**Interfaces:**
- Produces:
  - `compile_values(field: str, scenario: str | None, ctx: StateContext, catalogue, preset, pipe_rounds: int | None) -> RunPlan` (rounds = `pipe_window(rounds, anchor, pipe_rounds)` from Task 2) — one `EngineJob(key="values", kind="analysis", part="values", config=view_config(build_request(state, rounds=<window>, scenarios=[s], grouping_sets=[[field]], preset, other_grouping=False), preset))`; `s` = given scenario or first `party_scenarios_of(anchor.scenarios)`; rounds that did not ask `s` are dropped and listed in `not_asked` (as the grid compiler does, `cards/compile.py:88-91`); field missing in a remaining round → unavailable.
  - `translate_values(result: dict, field: str) -> FilterValues` with `FilterValues(_Strict)`: `kind: Literal["filter_values"]`, `field: str`, `values: list[str]` — distinct non-null `rows[*].dimensions[field].value` where `grouping_set_id` is the field's set, natural sort.
  - `CardRunService.start_values(field: str, scenario: str | None, ctx: StateContext, pipe_rounds: int | None) -> str`.

- [ ] **Step 1: Failing tests:** `test_values_job_config` (grouping `[["caste"]]`, no caste clubbing, no filters, no Other grouping); `test_values_uses_card_scenario_first`; `test_values_drops_rounds_not_asking_scenario`; `test_translate_values_distinct_sorted_no_null` (fixture rows with `None`, duplicates, `"g10"`/`"g2"` → `["g2","g10"]`); `test_values_run_cached_by_fingerprint` (two starts → one submission).
- [ ] **Step 2–4:** run (FAIL), implement, run full suite (PASS).
- [ ] **Step 5: Commit**: `git commit -m "feat: filter value lists from an engine distribution job"`

### Task 9: Empty library; seeds move to a test fixture

**Files:**
- Create: `tests/fixtures/cards.yaml` (the current `config/cards/cards.yaml` content, moved with `git mv`)
- Modify: `config/cards/cards.yaml` → `cards: []`; `tests/api/test_app.py`, `tests/cards/test_all_party_scenarios.py`, `tests/cards/test_benchmark_cards_yaml.py`, `tests/cards/test_config.py`, `tests/cards/test_ranking_compile.py`, `tests/cards/test_relationship_cards_yaml.py`, `tests/test_bootstrap.py` (read `tests/fixtures/cards.yaml`); `scripts/smoke_card.py` (`--cards PATH`, default `tests/fixtures/cards.yaml`); `web/src/context/ContextBar.tsx` (plan an inline card `{id:"context", family:"distribution", title:"Context", all_party_scenarios:true}` instead of `LEAD_CARD`); `web/e2e/cards.spec.ts` stub for the inline plan
- Test: `tests/test_bootstrap.py::test_production_library_may_be_empty`

- [ ] **Step 1: Failing test** `test_production_library_may_be_empty` — `load_card_config(config_dir)` returns `{}` cards and the app's `/cards` returns `[]`.
- [ ] **Step 2–4:** run (FAIL), move file and repoint, run backend suite + `npx vitest run` + `npm run e2e` (PASS).
- [ ] **Step 5: Commit** explicit paths: `git commit -m "chore: ship an empty card library; seeded cards become a test fixture"`

### Task 10: Frontend API layer

**Files:**
- Modify: `web/src/api/types.ts`, `web/src/api/client.ts`, `web/src/api/queries.ts`, `web/src/cohorts/cohortApi.ts`, card components (`CardShell.tsx`, `ranking/RankingCard.tsx`, `benchmark/BenchmarkCard.tsx`, `relationship/RelationshipCard.tsx`, `cohorts/CohortDialog.tsx`)
- Test: `web/src/api/client.test.ts`, `web/src/api/queries.test.tsx`

**Interfaces:**
- Produces (TS):
  - `type CardConfigJson` (mirror of `CardConfig` incl. Task 1 fields); `type CardRef = { card_id: string } | { card: CardConfigJson }`; `CardInfo.inline?: boolean`; `toCardRef(info: CardInfo): CardRef` (inline → `{card}` without `meta`/`inline`).
  - `Condition`, `FieldDescriptor`, `FamilyDescriptor`, `OptionItem`, `ValidateResponse`, `FilterValues` mirroring Tasks 5–8.
  - `planCard(ref: CardRef, ctx, reference?)`, `startRun(ref, ctx, reference?)`, `startPreview(ref, ctx, predicate, reference?)`, `validateCard(card: CardConfigJson, ctx): Promise<ValidateResponse>`, `startValues(field: string, scenario: string | null, ctx, pipeRounds: number | null): Promise<string>`.
  - Hooks: `useCardPlan(ref, ctx, reference?)`, `useCardRun(ref, ctx, enabled, reference?)` (query keys use `JSON.stringify(ref)`), `useFamilies()` (`staleTime: Infinity`), `useOptions(source: string, params: Record<string, string>, draft: CardConfigJson, ctx: StateContext)` (POSTs `/configure/options`; query key includes only the draft parts that change rounds read: mode, scenarios, comparison, `pipe_rounds`, benchmark reference).

- [ ] **Step 1: Failing tests:** `startRun sends card when inline and card_id otherwise`; `useCardRun restarts when the inline config changes`; `toCardRef strips meta and inline`.
- [ ] **Step 2–4:** run (FAIL), implement, `npx vitest run` + `npm run typecheck` (PASS).
- [ ] **Step 5: Commit**: `git commit -m "feat(web): card refs, configure types and API hooks"`

### Task 11: Condition evaluator and draft pruning

**Files:**
- Create: `web/src/configure/conditions.ts`
- Test: `web/src/configure/conditions.test.ts`

**Interfaces:**
- Produces: `getPath(draft: object, path: string): unknown`; `setPath(draft, path, value): object` (immutable); `evaluate(c: Condition, draft: object, kinds: Record<string, string>): boolean` (`kinds` maps scenario id → kind from the scenario option list); `visibleFields(d: FamilyDescriptor, draft, kinds): FieldDescriptor[]`; `pruneHidden(d, draft, kinds): object` (removes values of hidden fields; repeats until stable).

- [ ] **Step 1: Failing tests:** one per op (`equals`, `in`, `nonempty`, `contains` on list and list-of-lists, `kind_of`, `count_at_least`, `all`, `any`, `not`); `prunes values of fields hidden by their condition` (compare → standalone drops `comparison.reference`); `prunes chained dependants` (removing caste from cuts drops `caste_clubbing`).
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit**: `git commit -m "feat(web): configure condition evaluator and pruning"`

### Task 12: Widgets, renderer, validate and Apply

**Files:**
- Create: `web/src/configure/ConfigurePanel.tsx` (renderer), `web/src/configure/widgets/{ScenarioPicker,CutBuilder,FilterList,PartyPicker,ElectionPicker,ChoiceField,NumberField,ToggleField,TextField}.tsx`, `web/src/configure/useDraftValidation.ts`
- Test: `web/src/configure/ConfigurePanel.test.tsx`, `web/src/configure/widgets/FilterList.test.tsx`

**Interfaces:**
- Consumes: Tasks 10–11.
- Produces: `<ConfigurePanel family={string} initial={CardConfigJson} ctx={StateContext} onApply={(c: CardConfigJson) => void} onCancel={() => void} />`. Primary fields first; "More options" disclosure for `tier: "more"`; errors under fields by `path`; unavailable reasons and `notes` in a summary; Apply disabled until `valid`. `useDraftValidation(draft, ctx)` debounces 400 ms. `FilterList` loads values via `startValues` + run polling and marks chosen values absent from the list with "not in the selected rounds" (Review Focus 2).

- [ ] **Step 1: Failing tests:** `shows only primary fields first`; `More options reveals the rest`; `caste clubbing appears when caste is added to a cut`; `Shakti label when party target and opinion reference`; `shows field errors by path`; `Apply disabled while invalid and calls onApply with the pruned draft`; `validation is debounced`; FilterList `flags a chosen value missing from the current rounds`.
- [ ] **Step 2–4:** run (FAIL), implement, `npx vitest run` + typecheck (PASS).
- [ ] **Step 5: Commit**: `git commit -m "feat(web): configure panel and widgets"`

### Task 13: Local card list, add, copy, copy config

**Files:**
- Create: `web/src/configure/cardStore.ts`, `web/src/configure/AddCardMenu.tsx`
- Modify: `web/src/pages/CardsPage.tsx` (render stored cards as `CardInfo` with `inline: true` and `meta` from `useFamilies()`, plus library cards when `/cards` is non-empty), card menus (Configure, Copy card, Copy config), `web/src/cards/benchmark/BenchmarkCard.tsx` (remove the reference picker at lines 42-71; the reference now lives in the config and is shown read-only in the card subtitle; requests send no `reference`)
- Test: `web/src/configure/cardStore.test.ts`, `web/src/pages/CardsPage.test.tsx`, `web/e2e/configure.spec.ts`

**Interfaces:**
- Produces: `cardStore` with `list(state): StoredCard[]`, `add(state, config): StoredCard`, `replace(state, id, config)`, `remove(state, id)`, `copy(state, id): StoredCard`; key `mb.cards.<state>`; `StoredCard = { id: string; config: CardConfigJson }`; ids from `crypto.randomUUID()`; every storage call in try/catch with an in-memory fallback. Copy config writes `- ${JSON.stringify(config)}` (JSON is valid YAML) to the clipboard, **with** `id` (`load_cards` requires it, `config.py:365`); the owner renames it when pasting.
- Picking a library card stores a copy with a new id (owner rule).

- [ ] **Step 1: Failing tests:** `falls back to memory when localStorage throws`; `copy gives a new id and the same config`; `library pick stores a copy`; `Copy config is one YAML list item that load_cards accepts` (backend test `tests/cards/test_config.py::test_copied_config_loads` loads a fixture string in that format); CardsPage `adds a card of the chosen type and opens configure`; BenchmarkCard `shows the configured election reference and has no picker`. E2E `configure.spec.ts`: add a distribution card, pick a scenario, add a caste cut, see caste clubbing appear, Apply, see the card run; Copy card shows two cards.
- [ ] **Step 2–4:** run (FAIL), implement, `npx vitest run`, typecheck, build, `npm run e2e` (PASS).
- [ ] **Step 5: Commit**: `git commit -m "feat(web): add, configure and copy cards kept in the browser"`

### Task 14: Docs and ledger

**Files:**
- Modify: `docs/open-items.md`, `docs/specs/2026-11-19-card-configure-design.md` (the two amendments above), `README.md`/`CLAUDE.md` project-structure lines if present for `cards/configure/` and `web/src/configure/`
- [ ] **Step 1:** Ledger rows: decision "relationship joint weights from a scenario allowed; replaces the 5a base-only decision"; open item "seat segmentation (seat type/score from a past election, NDA/BJP+ view only, seat ranking and benchmark) deferred; design later; data in `acDashboard_retrosegement`"; open item "benchmark seat filters (`benchmark.filters`) not offered in configure; deferred by the owner"; decision "library cards are copied"; decision "cards.yaml ships empty"; sub-project 6 row → "6a done; 6b, 6c not started"; open item "card footer does not show pipe-window notes yet (shown in configure)".
- [ ] **Step 2:** Run the full backend suite, `npx vitest run`, `npm run typecheck`, `npm run build`, `npm run e2e` — all PASS; state that live checks were not run.
- [ ] **Step 3: Commit**: `git commit -m "docs: card configure decisions, amendments and ledger"`
