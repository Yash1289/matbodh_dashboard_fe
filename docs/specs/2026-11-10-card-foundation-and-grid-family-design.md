# Card Foundation and Grid Family — Design Specification

| | |
|---|---|
| **Status** | Draft for review (brainstormed with the product owner, 2026-11-10) |
| **Project** | `matbodh-dashboard` |
| **Sub-project** | 1 of 6 (see §2.2) |
| **Supersedes** | `2026-11-10-universal-card-component-design.md` and `docs/plans/2026-11-10-universal-card-component.md` (their body adapters and payloads did not match engine output) |
| **Engine contract source** | `MatBodh-Dash` 0.8.0: `docs/usage.md`, `docs/guides/*.md`, `sample-output/result*.json`, `sample-output/configs_v2/*.json` |

---

## 1. Intent

The dashboard shows survey-engine results as **cards**. The engine returns a small number of result *families*, each with its own keys and shape. Each family gets one modular card that handles every permutation of that family's contract, uses **every field the engine returns**, and exposes only the options that make sense for that family.

State Pulse (the page, its four templates, its scoreboard assembly and its tests) is **dropped entirely**. Cards are the product; pages are built later from cards.

Each card has two separate layers:

1. **Display controls** (on the card, instant, never run the engine): lens, view/cut, details, sort, transpose, conditional formatting, ordering, density.
2. **Configure** (a modal, runs the engine): what to compute. Designed in sub-project 6; this spec only fixes the `CardConfig` object that Configure will edit.

## 2. Scope

### 2.1 In scope (this sub-project)

- Cleanup of State Pulse and of code that does not match engine output (§11).
- The card foundation: `CardConfig`, `FamilySpec`, the family translator contract, `CardShell`, display controls, the field-coverage test harness.
- Three families that share the engine's `AnalysisResult`: **Distribution**, **Opinion scorecard**, **Gender differential**.
- Lenses, cuts (grouping sets), the 4-round pipe layout, inter-round and intra-round comparisons, conditional formatting, ordering and colour arguments, for those three families.
- Card definitions loaded from YAML (`config/cards/*.yaml`) instead of the pulse templates.

### 2.2 Decomposition (each later item gets its own spec → plan → build)

| # | Sub-project |
|---|---|
| 1 | **This spec**: foundation + Distribution, Opinion, Gender differential |
| 2 | Runner fan-out: one engine job per round (needed by ranking and benchmark; `AnalysisResult` already accepts many rounds in one request, so this spec does not need it) |
| 3 | Seat ranking and demographic ranking cards |
| 4 | Benchmark card |
| 5 | Relationship (transition) card and selection wrapper, including the investigation drawer |
| 6 | Configure modal (sentence builder) and live option lists |

### 2.3 Out of scope

Configure modal UI; live ClickHouse option lists; ranking, benchmark, relationship and selection cards; the per-state "universal overview" card (rounds as rows, scenarios as columns); admin editing of method presets; multi-state pages.

## 3. Principles

1. **The engine owns every number.** The backend renames, groups and selects engine fields; it never computes a percentage, delta, margin, rank or total. The browser never computes any number. Pipes are a *layout* of per-round engine values.
2. **Every returned field is accounted for.** Each family has a field map (§8). A test fails when the engine returns a key the map does not know.
3. **NULL is not zero.** Missing or unavailable values render `—` with the engine's reason (`missing_target`, `missing_reference`, not asked in a round, not applicable).
4. **Units come from the engine** (`unit`, `impact_unit`, `measure_units`: `percentage` or `percentage_points`), never from the lens name.
5. **Display controls never fetch.** Changing lens, cut, transpose, sort, format, order, density, details or hidden parties is in-memory. Only Configure (and the per-card comparison round) run the engine.
6. **Fixed numerical policy is admin-owned and hidden** (§4).
7. **Round labels are never bare.** `R1` appears only as a sub-header under a series-qualified name; titles, tooltips and aria-labels use the full name (`2027 VS CAPI R2`).
8. **No arbitrary choices.** Missing source availability, mappings, field encodings or readiness are errors, never defaults (project `CLAUDE.md` and engine rules).

## 4. Ownership of engine request fields

Every field of the engine `Request` (`usage.md`, "Configuration field inventory") has exactly one owner.

| Owner | Fields | User-visible? |
|---|---|---|
| **Admin preset** (`MethodPreset`, `config/presets/*.yaml`) | `weights`, `answers`, `parties` (keep, Other label, passthrough), alliances, `party_overrides`, `opinion_weights`, gender labels, `competition_excluded`, default caste threshold | Read-only in "How this was calculated" |
| **Global context** (`StateContext`) | `state`, `observations` (≤ 4 selected rounds), the anchor round (default latest) and the comparison round (both among the selected rounds), level (drives `geography_path`), version mode | Context bar |
| **Derived by the system** | `coverage_mode`, `reference_observation`, the `comparisons` objects, the hidden gender producers | No |
| **CardConfig** (§5) | `scenarios`, `grouping_sets` (as cuts), `filters`, comparison mode, `caste_clubbing` on/off, `gender_differential` on/off (family-implied) | Edited by Configure (SP6) |
| **Display only** (`View`, in-memory) | lens, active cut, details, sort, transpose, format, order, density, hidden parties (`display_parties` is applied client-side because it only hides output and changes no base) | On the card |

## 5. `CardConfig`

A `CardConfig` is a typed, validated object (pydantic on the backend, mirrored type in TypeScript). It is loaded from `config/cards/*.yaml` now and edited by Configure later. It replaces `CardTemplate`.

```yaml
cards:
  - id: coalitions.caste_support
    family: distribution            # distribution | opinion | gender_differential
    title: Support by caste
    scenarios: [vs_voting_intention]            # party scenarios only for distribution/gender_differential;
                                                # opinion scenarios only for opinion
    cuts:                                       # grouping sets; [] is Overall
      - []
      - [category]
      - [category, caste]
      - [category, caste, gender]
    filters:                                    # AND across entries; values within an entry are any-of
      - {field: party_zone, operator: in, values: ["Jat Belt"]}
    comparison:
      mode: compare                             # standalone | compare | trend (compare and trend never combine)
      target:    {round: anchor, scenario: vs_voting_intention}      # compare mode: two endpoints, each a round + a scenario
      reference: {round: anchor, scenario: ls_past}                  # same round + different scenario = intra-round
      # inter-round example: reference: {round: compare, scenario: vs_voting_intention}
      # trend mode instead: rounds default to all selected rounds (<= 4) and exactly one scenario (in `scenarios`)
      delta_measures: [support_share]           # which measures get engine deltas (opinion: net_score, positive_share, negative_share)
    caste_clubbing: true                        # threshold from the preset; reference observation = comparison round
    requires: {min_level: state}
```

Rules enforced by validation (all drawn from `usage.md`):

- `family` fixes which scenario kinds are allowed; scenario kind comes from the engine scenario catalogue (party, opinion). A mixed list is rejected.
- A cut is an independent output grain, not part of a cross-product. Cuts that collapse to the same grain (for example after gender is removed for gender differential) are rejected with a message.
- A geography dimension produces rows only when it is *in a cut*; filtering by it does not (`usage.md`).
- `caste` in any cut requires `category` to be available; `caste_clubbing` is valid only when `caste` is in a cut.
- `gender_differential` family: gender is not allowed in cuts (the engine removes it) and `comparison.mode` must be `standalone` or `trend` (the engine has no gender-differential comparison, so there is no `compare`).
- Filters: each has `operator in|not_in` and at least one string value; one entry per field; `AND` across entries (verified in `compiler.py`: each filter is `col IS NOT NULL AND col IN/NOT IN …`, joined with `AND`). Rows with no value for the field are excluded by both operators.
- Every selected scenario, field and dimension must be available in **every** selected round, otherwise `/cards/plan` returns the engine's unavailability reason (the engine rejects unverified availability).
- **Modes never combine.** `standalone`: one round (the anchor), one or more scenarios as columns. `compare`: exactly two endpoints (`target`, `reference`), each a round plus a scenario; the card config's `scenarios` is derived from them. `trend`: two to four rounds and exactly one scenario that is available in every one of them; the cell shows values only.
- `compare` endpoint rules (engine `Comparison`): both party scenarios give `kind: difference`; both opinion scenarios give `difference` on `net_score`, `positive_share` or `negative_share` (`delta_measures`); a party target with an opinion reference gives `kind: shakti`; any other mix is rejected with a message. Round values are `anchor`, `compare` or a selected round name; `anchor` and `compare` come from the context (or the per-card override), both among the selected rounds and different from each other.

## 6. Backend architecture

```
CardConfig + StateContext + MethodPreset
        │  FamilySpec.compile()
        ▼
   EngineJob(s)  ──►  existing runner (queue, cache, fingerprint, retries)  ──►  engine result(s)
        │  FamilySpec.translate()
        ▼
   CardPayload (typed, per family)  ──►  /cards/run  ──►  frontend
```

### 6.1 `FamilySpec`

One module per family under `matbodh_dashboard/cards/families/`:

```python
class FamilySpec(Protocol):
    name: str
    config_model: type[CardConfig]
    field_map: Path                    # field_map.yaml, see §8
    def capabilities(self, config) -> Capabilities: ...   # lenses, comparison modes, supports pipes/transpose/sort
    def compile(self, config, ctx, preset, rounds) -> list[EngineJob]: ...
    def translate(self, results, config, ctx) -> CardPayload: ...
```

Distribution, Opinion and Gender differential share `_analysis_common.py` (request building, comparison building, row/cut/column indexing). A new family adds one module and one frontend folder; it never edits the shell.

### 6.2 Request compilation

Reuse `build_request` and `view_config` (`compiler/requests.py`), extended with `filters`, `caste_clubbing` and `reference_observation`. The preset supplies all policy fields. One engine job per card.

- **Observations**: only the rounds the mode uses, as named observations with their series-qualified names: `standalone`, the anchor round; `compare`, the target and reference rounds (one round for intra-round); `trend`, the selected rounds (at most 4; see §13.7).
- **`standalone`**: no comparisons; one observation.
- **`compare`**: one engine `Comparison` per measure in `delta_measures`: `Comparison(target=(target.round, target.scenario), reference=(reference.round, reference.scenario), measure=m, kind=…)`. Intra-round and inter-round are the same operation with different endpoints. No comparison is built between any other pair of rounds, and no consecutive-round deltas exist. The number of comparisons is `len(delta_measures)`; the Configure footer (SP6) shows the count.
- **`trend`**: no comparisons. One observation per selected round (at most 4) and one scenario; the translator keeps each round's values as separate cells for the pipe layout.
- **`coverage_mode`** (`compare` only; `standalone` and `trend` use `independent`, see §13.9): `common` (chosen by the existing `choose_coverage`, which returns `common` or `independent`; `reference_observation` is the reference round) whenever any cut or filter uses seat-level geography (`ac_num`, `pc_num`, and any other dimension not verified zone-only, see §13), otherwise `independent` (allowed for Overall, demographic and zone-only comparisons per `usage.md`). The existing `compiler/coverage.py` logic is reused.
- **Caste clubbing**: `{threshold_pct: preset.caste_threshold_pct, reference_observation: the reference round in `compare` mode, otherwise the anchor round}`.
- **Gender differential**: `gender_differential` object from the preset, the `gender` dimension excluded from cuts.
- **Validation**: the plan step runs the engine's own `resolve` path (`--resolve-only` equivalent) before any respondent SQL; unavailability reasons surface as `unavailable` entries, not exceptions.

### 6.3 Payload

All numbers are engine values copied unchanged. Keys are in long format so the browser pivots without arithmetic.

```ts
interface GridPayload {
  family: "distribution" | "opinion" | "gender_differential";
  card_id: string;
  rounds: RoundsBlock;                 // existing: items, anchor, compare, groups; full series-qualified labels
  meta: FamilyMeta;                    // lenses, comparison modes, capabilities (single source of truth; the frontend does not duplicate it)
  columns: Column[];                   // {key, label, scenario, kind: "party"|"option"|"scale", colour, lenses?: string[]}  (lenses: the lenses a column applies to; omitted = all)
  cuts: Cut[];
  unavailable: PartReason[];           // existing, with engine reasons
  not_asked: NotAsked[];               // from context_status, per round and scenario
  provenance: Provenance;              // contract summary, resolved_datasets, versions: for the method drawer
}
interface Cut {
  id: string;                          // grouping_set_id
  dimensions: string[];
  rows: RowDef[];                      // {key, labels: Record<dim, string|null>, subtotal: string[]}
  cells: CellValue[];                  // {row, column, round, lens, value, status}
  deltas: DeltaValue[];                // `compare` mode only: {row, column, lens, target, reference, value, reference_value, relative_change_pct, status}
  bases: BaseDetail[];                 // per row/column/round: the base and mass fields of §8, shown in the details popover
}
```

- `status` is the engine's `coverage_status` / `impact_status` (`available`, `aligned`, `missing_target`, `missing_reference`, `not_covered`).
- `subtotal` lists dimensions outside the cut (engine `is_subtotal: true`); a genuine NULL value is never replaced by a subtotal label.
- The plan must measure payload size for the two largest samples (`result_gd_complex.json`, 7 638 rows; `result_ac_1.json`, 7 574 rows). If either exceeds 2 MB gzipped, the plan chooses a compact column-oriented encoding; the logical schema above does not change.

## 7. Lens and view catalogue

A **lens** shows the same rows and columns with a different engine measure. A **view** is a different structure. This sub-project has lenses and a cut selector; there are no other views.

Lenses appear only when the engine returned a non-null value for them. Labels follow the engine guides (`docs/guides/impact-and-gender.md`, `docs/guides/opinion-analysis.md`).

| Family | Lens (engine field) | Unit (from engine) | Meaning (engine guides) | Delta source |
|---|---|---|---|---|
| Distribution | Support % (`support_share`) | percentage | how the group answers (default) | `comparisons[*].percentage_point_difference` |
| | Population share % (`composition_share`) | percentage | factored base-weight composition, equal to `impact_population_share` | none |
| | Contribution % (`contribution_share`) | percentage | scenario-based contribution | none |
| | Scenario share % (`scenario_composition_share`) | percentage | scenario-specific composition | none |
| | Joint % (`joint_share`) | percentage | `support_share × scenario_composition_share / 100` | none |
| | Impact pp (`size_of_impact_pp`) | percentage_points | support × composition, applied once | `comparisons[*].size_of_impact_pp` (alias `impact_pp`) |
| Opinion | Net (`net_score`) default | percentage_points | positive − negative | comparison with `measure=net_score` |
| | Positive % / Negative % | percentage | gross shares | comparison when listed in `delta_measures` |
| | Impact variants (`net/positive/negative_size_of_impact_pp`) | percentage_points | same impact rule per score | comparison `size_of_impact_pp` |
| | Answer distribution (ordinal `rows`, `option_id`) | percentage | support per option; shown as the same grid with option columns | as Distribution |
| Gender differential | Differential pp (`gender_differential_pp`) default | percentage_points | female − male support | none (not supported by the engine) |
| | Female % / Male % | percentage | support among each gender | none |
| | Impact pp (`size_of_impact_pp`) | percentage_points | impact status in `impact_status` | none |

Relative change (`relative_change_pct`) is shown in the delta tooltip, never as a lens. Counts, raw bases and ranks never get impact or delta treatment (engine rule).

## 8. Field coverage map

Each family has a `field_map.yaml`. Every key at each level of the engine result (`rows`, `scores`, `comparisons`, `gender_differentials`, `populations`, `context_status`, `contract`) is listed once with a role:

| Role | Where it appears |
|---|---|
| `lens` | a lens in the toolbar |
| `row` / `column` | a row or column identity (`dimensions`, `party_id`, `option_id`, `scale_id`, `scenario_id`) |
| `delta` | a delta line or tooltip |
| `detail` | the details popover (bases, masses, options, counts) |
| `status` | drives `—` and its reason (`coverage_status`, `impact_status`) |
| `provenance` | the method drawer (namespaces, mapping versions, `contract`, `resolved_datasets`, `state`, `survey_id`) |
| `ignored` | with a written reason, only where a key is an internal grain marker (for example `group_mask`) |

Keys observed in the sample outputs (the starting list; the test is authoritative):

- `rows`: `support_share, contribution_share, composition_share, joint_share, scenario_composition_share, size_of_impact_pp, impact_population_share, impact_unit, impact_weight_basis, unit, weighted_numerator, weighted_denominator, unweighted_numerator, unweighted_base, population_group_base, population_raw_base, population_total_base, geography_population_base, coverage_status, dimensions, group_mask, grouping_set_id, observation_id, scenario_id, party_id | option_id, outcome_domain, party/option namespace and mapping versions, state, survey_id`.
- `scores`: `positive_share, negative_share, net_score, positive/negative/net_size_of_impact_pp, positive_mass, negative_mass, positive_options, negative_options, scale_id, scale_version, measure_units, composition_share, impact_population_share, geography_population_base, weighted_denominator, unweighted_base, coverage_status, dimensions, group_mask, grouping_set_id, observation_id, scenario_id, state, survey_id`.
- `comparisons`: `comparison_id, kind, measure, party_id, target, reference, target_value, reference_value, target_share, reference_share, target_base, reference_base, percentage_point_difference, relative_change_pct, size_of_impact_pp, impact_pp, impact_status, population_observation_id, population_share, coverage_status, difference_unit, dimensions, group_mask, grouping_set_id`.
- `gender_differentials`: `gender_differential_pp, female_support_share, male_support_share, female_base, male_base, female_mass, male_mass, geography_female_base, geography_male_base, size_of_impact_pp, impact_status, impact_weight_basis, coverage_status, party_id, party namespace and mapping version, dimensions, group_mask, grouping_set_id, observation_id, scenario_id, state, survey_id, unit`.
- `populations`: `composition_share, impact_population_share, population_group_base, population_raw_base, population_total_base, geography_population_base, weight_basis, unit, dimensions, group_mask, grouping_set_id, observation_id, state, survey_id` (groups with no eligible outcome answers appear here only; they render as population rows with `—` outcome cells, never as zero).
- `contract`: provenance block (`field_bindings, scenario_bindings, comparison_definitions, opinion_weight_binding, population_reference_scopes, master_versions, resolved_datasets, source_verification, size_of_impact, request` …).

**Test:** for each family, load every matching file under `sample-output/` (listed in the family's test table), walk every result array, and fail if a key is not in the map or if a mapped key is never reachable in the translator output. Adding a new engine key therefore fails the build until it is mapped.

## 9. Frontend architecture

### 9.1 Components

```
web/src/cards/
  CardShell.tsx            header, subtitle, control strip, body slot, footer, drawers
  controls/                one small component per display control (Lens, Cut, Details, Sort, Format, Order, Transpose, Density, Search)
  PopoverChip.tsx          existing primitive, extracted from CardToolbar
  families/
    distribution/  Body.tsx  columns.ts
    opinion/       Body.tsx  columns.ts
    gender_differential/ Body.tsx columns.ts
    _grid/         GridBody.tsx  PipeCell.tsx   shared by the three
```

`CardShell` takes a `GridPayload` and a `FamilyView` (the family's display state). The family folder supplies only the body and column rules; **which controls appear comes from `payload.meta.capabilities`** (no duplicated catalogue in TypeScript). A fourth family adds a folder and a backend module.

### 9.2 Display controls (all in-memory)

| Control | Behaviour |
|---|---|
| **Cut** | tabs/segmented over `payload.cuts`; each cut has its own row structure |
| **Lens** | switches `lens` over `meta.lenses` that have data; unit from the payload |
| **Details** | popover/toggle for `bases` fields and engine `status` reasons |
| **Sort** | by any value or delta column, nulls last, stable; reset restores engine order |
| **Transpose** | swaps rows and columns (grid families only) |
| **Format** | none, diverging (red↔green, centred on zero for deltas and net/impact), heat (single hue); scope column, row or table; applies to the active lens; values always printed; legend in the footer |
| **Order / colours** | props `order {rows, columns, pinLast}` and `colors`; default from `GET /api/presentation/{state}`; the card prop overrides; unlisted items go before pinned items |
| **Density / cell parts** | compact, standard, detailed; value, delta, trend (sparkline), base |
| **Search / hide** | client search over rows; hide party columns (`display_parties`) |

### 9.3 Pipe layout

The three modes (§5) have three cell layouts. **Delta and pipes never appear in the same cell.**

- **Standalone**: one value per column.
- **Trend** (2–4 rounds, one scenario, no delta): round sub-columns under each column header, separated by thin rules, holding values only: `R1 | R2 | R3 | R4`. Sub-headers use the bare round label; the full name is in the tooltip and aria-label.
- **Compare** (two endpoints, one delta per cell): every cell shows the target value together with its engine delta against the reference, labelled with the reference (for example `45% ▼7 vs LS voting intention`, or `45% ▲7 vs 2027 VS CAPI R1`). A delta never appears without its target value; the reference value is in the details popover (`reference_value`). Rows are the cut, columns are parties or options, and a scenario never becomes a row. There are no consecutive-round deltas.
- Arrows and signs always render; colour is supplementary.
- Trend uses at most 4 rounds (context rule, §13.7). The sparkline remains an optional cell part in trend mode, fed from the per-round cells.

### 9.4 Accessibility and performance

Wrapping chip strip with `+n` overflow; visible focus rings; sticky header and first column that never hide a focused cell (scroll padding); horizontal scroll for wide tables; rows virtualised above 100; heat/diverging colours with printed values and a legend; keyboard operable popovers; reduced-motion respected. Existing `formatPercent`, `formatDelta` and flag rules in `web/src/cells/format.ts` are retained.

## 10. API

- `GET /templates` → `GET /cards` (the `CardConfig` list with capabilities; filtered by section as before).
- `POST /cards/plan` and `POST /cards/run`: same envelope (`card_id`, `context`); the run result is a `GridPayload`. An optional `config` override is reserved for SP6 and rejected for now.
- `GET /api/presentation/{state}`: unchanged.
- `RunStatus`, caching, fingerprints, retries and the queue: unchanged. The fingerprint now includes the compiled `CardConfig`.

## 11. Cleanup

**Remove (State Pulse)**: `web/src/pages/StatePulse.tsx` (+test), `CoverageStrip.tsx` (+test), `web/e2e/state-pulse.spec.ts`, `scripts/smoke_state_pulse.py` (replaced by a card smoke script that takes a card id), `config/templates/pulse.yaml`, the `templates_pulse.json` and `run_*_done.json` fixtures, the pulse-specific cases in `tests/compiler/test_engine_configs.py`, `tests/api/test_app.py`, `tests/api/fixture_export.py`, and State Pulse mentions in `README.md` and `CLAUDE.md`.

**Remove (does not match engine output)**: `body_adapter`; `ranked_list`, `transition`, `battleground` payload types and their three body components and tests; the scoreboard and single-grid `normalise` assembly (`normalise/cells.py`, scoreboard parts of `compiler/plan.py` and `runner/service.py`); `CardResult.scoreboard`, `OpinionRow`, `ScoreboardRow`, and the `operation` union.

**Keep**: theme and tokens; `web/src/cells/*` (format, pieces, Sparkline, SeatsCell, CompositeCell); `table/formatRules`, `table/csv`, `table/grid` (transpose, sort, ordering); `PopoverChip`, `CardFilterBar` (slicer chip, used by the Search/hide control and later by SP6), `MethodDrawer`, `InvestigationDrawer` (unused until SP5); `AppShell`, `ContextBar`, `ContextDialog` (uncommitted edits stay untouched); the catalogue, capability, context, runner (queue, cache, fingerprint), presets and presentation API.

**Rewrite**: `Card.tsx` (becomes `CardShell`), `CardToolbar.tsx` (split into `controls/`), `bootstrap.py` (loads `config/cards/*.yaml`), `compiler/plan.py` (becomes the family compile step; helpers for benchmark jobs are retained for SP4).

The cleanup is done on a new branch from the current head so the uncommitted `ContextBar`, `ContextDialog`, design-spec and e2e edits are preserved.

## 12. Testing

- **Compile tests (pytest)**: each family compiles representative `CardConfig`s to engine requests that equal the corresponding `sample-output/configs_v2` shape (policy fields from the preset), including inter-round and intra-round comparisons, coverage mode selection, caste clubbing, filters, and rejection cases from §5.
- **Translator tests**: run each family's translator over the real sample results. Property test: every numeric value in the payload equals a value in the source result (no derived numbers).
- **Field coverage tests**: §8.
- **Unit tests (vitest)**: lens switching and unit; null/`—` reasons; pipe layout; delta signs; sorting nulls; transpose keeps lens and unit; format scope; ordering with pinned and unlisted items; cut switching.
- **Component tests**: control strip wraps and overflows; popovers keyboard operable.
- **e2e (Playwright)**: against fixture payloads exported from the real samples; no live database.
- **Live check**: a smoke script for one card and one real state, **not run without product-owner approval** (project rule); expected and actual results are documented when run.
- Run `pytest` in the project virtual environment and `pnpm test`; skipped tests are not passes.

## 13. Open questions and assumptions

1. **Seat-level classification for coverage (still open).** `ac_num` and `pc_num` are seat-level; `party_zone` and `zone` are zone-only (per `usage.md`). `district` is treated as seat-level (conservative) in `SEAT_DIMENSIONS` until verified.
2. **Dimension order inside a cut (still open).** Assumed to affect only row nesting; no task exercised it, so it is unconfirmed.
3. **`contribution_share` tooltip wording (still open).** Not implemented: lenses carry an id, label, unit and delta flag only; the wording is still to be taken from `docs/guides/impact-and-gender.md`.
4. **Binary (Yes/No) options (resolved by reading the engine).** Yes/No scenarios have domain `boolean` (`default_scenarios()` in `matbodh_dash/catalog.py`); none appears in the samples. They are option columns owned by the opinion family, and the field-coverage test flags any new value.
5. **Payload size (measured, 2026-11-10).** `scripts/measure_payload.py`, standalone mode, first scenario, latest observation: `result_ac_1.json` (distribution) 2016 payload rows, 11.44 MB JSON, 0.79 MB gzipped; `result_gd_complex.json` (gender differential) 2032 payload rows, 8.08 MB JSON, 0.96 MB gzipped. Both are under the 2 MB gzipped threshold of §6.3, so the long-format encoding stays. The raw JSON is large; browser parse time on slow devices is untested.
6. **Comparison count.** Opinion deltas default to `net_score` only (`delta_measures`), to bound the number of engine comparisons; positive/negative show values without deltas unless listed.
7. **Anchor and comparison round (resolved, 2026-11-10).** The comparison round is one of the up to 4 selected rounds, matching `capability.validate_context` (it must be among the selected rounds and differ from the anchor). The anchor is the context's `anchor_round` (default: latest selected round, `resolve_anchor`). In `compare` mode they are the default `anchor` and `compare` endpoints; a per-card override picks from the selected rounds.
8. **Modes (resolved, 2026-11-10).** `compare` (two endpoints, value plus one delta per cell) and `trend` (2–4 rounds, one scenario, pipes) never combine; each cell has either a delta or pipes. A scenario is never a row.
9. **Trend coverage (resolved, 2026-11-10).** `trend` and `standalone` use `independent` coverage because no cross-round arithmetic happens; an Overall or aggregate cut may then reflect changing seat coverage between rounds. The card shows the per-round coverage note. An opt-in `common` coverage is out of scope here and can be added later.

## 14. Acceptance criteria

- State Pulse and the listed dead code are gone; unrelated uncommitted edits are intact; the test suites pass without skips attributable to this work.
- For each of Distribution, Opinion and Gender differential, a card renders every relevant `sample-output` result with no unmapped key (field-coverage test green).
- Lens, cut, sort, transpose, format, order and details change the display with no network request (asserted in tests).
- In `trend` mode (2–4 rounds, one scenario) a card shows pipe-separated values per round and no delta. In `compare` mode (two endpoints) every cell shows the target value and one engine delta against the reference. The two never appear together, no delta is computed in Python or TypeScript, and no consecutive-round delta exists (property tests).
- A missing value renders `—` with the engine's reason, never `0`.
- Adding a fourth family requires a new backend module and a new frontend folder only.
