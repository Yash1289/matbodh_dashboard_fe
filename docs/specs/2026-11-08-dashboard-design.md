# MatBodh Dashboard — Design Spec

| | |
|---|---|
| Status | Draft for review |
| Date | 2026-11-08 |
| Engine | `matbodh-survey-backend` 0.8.0, repo `MatBodh-Dash`, commit `2fb1af6` plus the uncommitted `coverage_mode: common` change |
| Wireframe | [Figma — MatBodh Dashboard – Wireframes](https://www.figma.com/design/KAwwifuB30DnFUatxqYVN6), page "State Pulse – wireframe" (frames A–E; predates §8 composite cells) |

This document records every decision agreed during design brainstorming. Items still undecided are listed in §20 and must not be resolved silently during implementation.

---

## 1. Purpose and users

A standalone, multi-page web dashboard on top of the MatBodh survey analytics engine. It must expose the engine's flexibility (any question, slice, round, comparison, ranking, benchmark, relationship, seat selection) without overwhelming users.

**Users:** analysts, field intelligence teams and management.

**Stance: neutral across parties.** No party is privileged by default. A *focus party* is an optional lens; cards that need one show a prompt instead of choosing a party.

**Guiding principles**

1. **The engine owns every number.** All shares, bases, totals, deltas, impacts, ranks, seat counts, winners and margins come from engine output. The dashboard never sums, subtracts or averages survey numbers; it only places engine values side by side, orders, labels and formats them.
2. **Impossible combinations are never offered.** Survey level, question availability and operation rules decide what the UI shows before anything runs.
3. **Related values read together in one table cell** (§8).
4. **Rounds are always shown side by side**, with a separate two-round delta.
5. **Method choices are admin presets**, hidden from users but visible read-only.
6. **Nothing is silently dropped or defaulted.** Missing data is "—" with a reason, never 0.

## 2. Scope

**In scope (phases in §19):** five curated sections, the guided builder, saved cards, multi-round views, presentation rules, conditional formatting, API service with background jobs and result cache, cross-state views, then access control.

**Out of scope until separately decided:** numeric summaries, generic DAG execution, longitudinal respondent linkage across rounds, uncertainty/margin-of-error display (§20), pooled national figures across states, cancelling running ClickHouse queries, drag-and-drop dashboard composition, sharing/permissions (phase 4), "Present" mode.

## 3. Engine facts this design relies on

Verified against the engine repo during brainstorming.

| Fact | Consequence for the dashboard |
|---|---|
| One `Request` = one state (`Request.state`; the session builder rejects multiple states) | Multi-state views run one request per state (§15) |
| A request may contain any number of named observations (rounds); every result row carries `observation_id` and `state` | Most multi-round views need one run; the frontend lays rounds side by side |
| Ranking and benchmark take one target endpoint (benchmark optionally one reference) | Multi-round rankings/benchmarks run once per round (or per pair) and are joined by seat |
| Relationships return one matrix per observation | Multi-round matrices need one run |
| `warehouse.survey_datasets` stores `dataset_id, state, survey_name, variant (normal/extrapolated), collection_level, cycle_id, round_number, survey dates, available_fields, available_fields_miscellaneous, available_scenarios`; `survey_dataset_levels` stores per-level `source_survey_id, is_borrowed` | Catalogue, round labels, availability checks and borrowed markers come from metadata |
| `collection_level` is derived from the registry `weighing_level` (`ac_no→ac, pc_no→pc, ac_zone/pc_zone→zone, state→state`) | Survey level = the level weighting was done at; it drives the capability table |
| Extrapolated datasets borrow earlier-round responses for missing native levels within the same cycle/series; they are emitted only when borrowing adds IDs; zone/state datasets never borrow | Extrapolated default with Normal fallback; borrowed values flagged |
| `coverage_mode`: `independent`, `reference_complete`, `common` (new). Alignment is enforced only when `ac_num`/`pc_num` appear in grouping sets or filters; `common` reports `coverage.excluded_by_observation` | "Matched seats only" = `common`; coverage note comes from the contract |
| Automatic alliances map **all survey scenarios with current (SURVEY) alliances**; actual endpoints use ACTUAL with explicit year/type | Cross-era deltas compare today's coalitions (open decision §20) |
| Survey competition is alliance-first; actual competition is party-first then alliance attribution; PC results pool all constituent ACs; partially covered PCs are excluded | Seat cells and PC counts follow these rules |
| Gender differential applies to party scenarios only | Gender gap offered only for party questions |
| The engine never caches respondent rows or results; the metadata session must be cleared after metadata publication | The dashboard owns a result cache keyed by versions (§13) |
| The result `contract` explains bindings, policies, coverage and resolved datasets | Feeds the "How this was calculated" drawer and coverage notes |

## 4. Domain model

| Object | Definition |
|---|---|
| **Context** | Global, URL-encoded. `states[]`; per state: survey level, `rounds[]`, `compare_round` (optional), `anchor_round` (= delta target, default latest), `version_mode` (`extrapolated` default \| `matched`); `focus_party` (optional); `geo_scope` (whole state \| zones \| districts \| seats, limited by level) |
| **Round identity** | `cycle` (`cycle_id`, e.g. "2027 VS") + `series` (survey name minus cycle and R-token, e.g. "AC CAPI", "National Tracker", "CAPI REBEL") + `round` (`round_number`) + `variant` + fieldwork period (shown only when dates are valid) + seat coverage + `dataset_id` |
| **Method preset** | Admin-owned, versioned: weight mode and invalid/zero policy, answer exclusions, alliance reporting type, Other-grouping keep list, caste threshold and reference-round rule, opinion weight source, gender labels, optional low-base threshold |
| **Card template** | Declarative datacut: id, section, title, engine operation, question(s), measures, allowed Rows/Columns/Cell parts, allowed slices and filters, requirements (min level, focus party, min rounds, availability), round handling (`native` \| `per_round` \| `pair`), default layout/cell/density, default chart, companion cards |
| **Card instance** | Template + user choices (question, slices, filters, layout, cell parts, density, format rules, chart). Saved cards are named instances |
| **Section** | Ordered layout of templates: lead card + companions |
| **Custom template** | Builder output; same structure and the same compiler/validation path as curated templates; owned by a user |

**Example template**

```json
{
  "id": "coalitions.support_by_caste",
  "section": "coalitions",
  "title": "Vote share by caste",
  "operation": "distribution",
  "question": {"default": "vs_voting_intention", "selectable": "party_questions"},
  "measures": ["support_share", "composition_share", "gender_gap"],
  "slices": {"options": ["caste_cascade", "age_group", "gender", "occupation", "urban_rural", "party_zone"], "default": "caste_cascade"},
  "filters": {"respondent": true, "seat_attribute": true},
  "requires": {"min_level": "state", "focus_party": false, "min_rounds": 1},
  "rounds": "native",
  "preset": "standard-v1",
  "layout": {"rows": "caste", "columns": "party", "cell": ["value", "delta", "trend"]},
  "density": "standard",
  "chart": {"default": "table", "alternatives": ["grouped_bar", "slope"]},
  "companions": ["coalitions.top_castes_per_seat", "pulse.party_scoreboard"]
}
```

## 5. Survey levels and the capability table

**Survey level** is the published `collection_level` (= weighting level). Rounds can be combined only within the same state and the same level. Cycle and series may differ (e.g. 2027 VS AC CAPI R2 with 2022 VS AC CAPI R4). Mixing series is allowed but labelled "different survey series".

| Capability | AC-level | PC-level | State / zone / other (v1) |
|---|---|---|---|
| Statewide views | ✓ | ✓ | ✓ |
| Demographic slices | ✓ | ✓ | ✓ |
| Geographic slices | zone, party zone, district, PC, AC | PC zone, PC attributes, PC | — (own level later via configuration) |
| AC seat views | ✓ | — | — |
| PC seat views | ✓ (a PC requires all its ACs covered) | ✓ | — |
| Seat counts, flips, margins | AC and PC | PC | — |
| Seat ranking, "Investigate these seats" | AC and PC | PC | — |
| Version mode | Extrapolated / Matched seats | Extrapolated / Matched seats | Normal only, no toggle |

**Section behaviour**

- **State Pulse:** all levels; seat cells only for AC/PC.
- **Seat Battleground:** AC/PC only; for other levels the tab shows "Seat views need an AC or PC level survey".
- **Voter Coalitions:** all levels; geographic slices follow the table.
- **Leadership & Anti-incumbency:** leader and government ratings for all levels; MLA report card by seat needs AC; MP by seat needs AC or PC.
- **Vote Movement:** all levels; geographic slicing follows the table.

Unavailable cards stay visible, greyed, with a reason and, where possible, a way out (e.g. "Switch to an AC-level survey"). Cards meaningless at a level are removed with a one-line explanation.

Zone, vibhag and district levels are future configuration entries ("this level supports views at its own grain"). They need metadata/engine work first (§21).

## 6. Rounds, versions, coverage and deltas

**Round selection** (context editor): grouped by cycle and series; any cycle within the chosen level; ordered by cycle then round order from metadata, never by label.

**Version mode**

- `extrapolated` (default): each round uses its Extrapolated dataset if one exists, otherwise Normal (the fallback is recorded and shown). Values that include borrowed seats are marked `*` in seat-level views ("carried from an earlier round"), using `is_borrowed` / `resolved_datasets`.
- `matched`: each round uses its Normal dataset with `coverage_mode: common`, so only seats every selected round surveyed are used.

Version mode only matters for cuts that involve seats.

**Coverage rule (compiler):** set a coverage mode only when the cut uses `ac_num`/`pc_num` (seat grouping or filter, rankings, benchmarks, selections). Statewide and demographic cuts run `independent`. Whether seat-attribute axes such as party zone trigger alignment follows the engine's coverage rule and must be confirmed during implementation (§20).

**Coverage note:** every seat-related card shows per-round coverage and version, e.g. `27 AC CAPI R1: 380 seats · Normal (no Extrapolated version) · 27 AC CAPI R2: 403 · Extrapolated`, and, in matched mode, the engine's `excluded_by_observation`.

**Delta:** `Δ = anchor round − compare round`, in percentage points (or seats), computed by the engine: a `Comparison` for shares and scores, a paired benchmark for seats. A seat Δ from the paired benchmark uses only seats eligible in both rounds, so when the two rounds' coverage differs it can differ from the gap between the two displayed per-round totals; such cells carry a footnote ("Δ on N common seats"). The compare round is global in the context; a card may override it. Delta headers always name both rounds (`Δ 27 AC CAPI R3 − 22 AC CAPI R4`). A side missing coverage or the question → "—" with a reason.

## 7. Sections

Every section opens with a lead card and companion cards. All cards follow §8.

### 7.1 State Pulse — "Where does each party stand?"

- **Lead: Party scoreboard.** One row per canonical party (preset keep list + Other + Undecided/NOTA). Composite-cell columns:
  - **Vote share** — value · Δ · trend (distribution + comparison).
  - **Seats AC · PC** — anchor-round seat leads at AC and PC level, each with Δ (one benchmark per round per level; Δ from the paired benchmark). AC/PC-level surveys only; PC-level surveys show PC only.
  - **Gender gap** — women − men, pp, with F/M shares as secondary (gender differential).
  The top row of the scoreboard replaces the separate headline tiles; the anchor round is named under the header.
- **Companions:** leader & government scorecard (net scores; "Not asked" cells); appetite for change of state government (Yes / No / Net — a statewide question, not per party, so a separate card); Shakti (needs a focus party; empty prompt otherwise); vote by party zone (AC/PC only; value · Δ · trend cells, heat on Δ); drill-down to other sections.

### 7.2 Seat Battleground — "Which seats are won or lost, and why?" (AC/PC only)

- **Lead:** benchmark of survey vs a past actual election (e.g. 2022 VS) and round vs round: seat winners, flips (gain, loss, winning both, losing both), margin buckets `[0,5) [5,10) [10,∞)`, by party zone or segmentation (Battleground / Difficult / Favorable / Safe).
- **Seat table cells:** winner cell (`NDA +7.2 ↻ from SP+`), share · Δ, rank (`#3 (was #7)`).
- **Companions:** seat ranking by party support or change; sortable seat table; later a seat map (needs boundary GeoJSON, §20).
- **Signature action:** "Investigate these seats" → entity selection (e.g. close losses, margin −5 to 0) → opens other sections filtered to those seats.

### 7.3 Voter Coalitions — "Who votes for whom?"

- **Lead:** support by category → caste cascade (caste grouping with an explicit reference round), switchable to age, gender, occupation, urban/rural, income, zone (AC/PC).
- **Lenses:** "How does this group vote?" (support share, row %) ↔ "What is the party's vote made of?" (composition/contribution, column %) — the Lokniti dual view; **Gender gap** lens (women − men per party, plus gender impact; party questions only; also on recalled vote).
- **Companions:** top castes per seat for a party (demographic ranking), change per group, saved custom segments (conditional variables, e.g. JYM / Non-JYM, caste blocs).

### 7.4 Leadership & Anti-incumbency — "Are faces and governments helping or hurting?"

- **Lead:** scorecard of net scores (PM, CM, HM, RG, state and central government).
- **Companions:** Shakti per leader (focus party), CM − PM net gap, MLA/MP report card (awareness, satisfaction, availability, development, image, want-a-change), seat ranking by MLA change appetite (AC), MLA rating next to party vote per seat. "Do women rate the CM better?" is an ordinary sliced opinion cut here, not the gender-gap measure.

### 7.5 Vote Movement — "Where are votes coming from and going?"

- **Lead:** same-respondent matrix, recalled last vote → current intention (kept, lost, gained, converted).
- **Companions:** LS-past → VS intention (split ticket), MLA candidate's party → party vote, CM/PM choice → party; slices by gender/zone.
- Round-over-round shifts are labelled "shift in totals, not voter flows"; there is no respondent linkage across rounds.

### 7.6 Cross-cutting card features

- **Question selector** on every party-vote card: vote intention (VS), MLA candidate's party, LS intention, second preference (`_alt`), moderated (`_mod`), recalled last vote, CM/PM choice party. The card title changes with the question; candidate preference is never labelled "vote share". Rounds without the question show "—".
- **Compare with** another question in the same round: `value vs value (Δ)` cells (engine comparison between scenarios), plus "See who switches →" to the Vote Movement matrix for the same pair.
- **Drill-down menu** on any value: filter this section to X, open in another section, investigate these seats, slice further. The context carries over.
- **Card "⋯" menu:** how this was calculated (contract drawer), export, refresh, open in builder, pin to My cards, view data.
- **View data** tab per card: the normalised rows plus download (Lokdhaba pattern).
- **Analyst note:** a short note pinned to a card (poll-tracker commentary pattern).

## 8. Tables and composite cells

Tables are the primary visual. Every table is defined by **Rows / Columns / Cell**:

- **Rows / Columns:** any of party, round, question, dimension (caste, zone, …), seat, measure. `⇄ Transpose` swaps rows and columns in one click. Layout is display-only: no new query.
- **Cell:** the parts shown in each cell, chosen from the template's allowed parts.

**Cell anatomy**

```
┌───────────────────────────┐
│ 41.5        ▲4.3          │  primary value · signed Δ vs compare round
│ ▁▂▃▅  33.0→41.5      n 2.1k│  trend · base
│ *                         │  flags: * borrowed · — not asked · ◌ low base
└───────────────────────────┘
```

**Cell parts:** value, Δ, trend (pipes `a | b | c | d` up to 4 rounds; sparkline with series breaks above 4), base (weighted/raw), AC·PC, second level, flags.

**Cell types**

| Cell | Example | Engine source |
|---|---|---|
| Share · Δ · trend | `41.5 ▲4.3 ▁▃▅` | support share + comparison |
| Seats AC · PC | `240 · 48` / `+12 · +3` | AC and PC benchmarks |
| Seats + vote | `240 seats · 41.5%` | benchmark + distribution |
| Seat winner | `NDA +7.2 ↻ from SP+` | benchmark seat result + flip |
| Net score | `+24` / `58 sat · 34 dis` | opinion scores |
| Gender gap | `+4.6` / `F 44.1 · M 39.5` | gender differential |
| Group dual view | `62% of group → NDA` / `18% of NDA vote` | support + composition |
| Two questions | `41.5 vs 38.0 (+3.5)` | scenario comparison |
| Flow | `72% stay` / `18% → SP+` | relationship |
| Rank | `#3 (was #7)` | per-round ranking (values placed side by side, no subtraction) |

(Examples are illustrative, not survey data.)

**Presets** (replace the earlier "Show" control): `Share`, `Δ only`, `Both`, `Both + trend`.

**Density:** Compact (value + Δ), Standard (+ trend), Detailed (+ base and flags). Management defaults to Compact, analysts to Standard.

**Many rounds:** pipes are the default trend form up to 4 rounds; above 4 the trend becomes a sparkline and the card says so. Users may instead lay rounds out as columns under series header rows.

**Round labels:** never a bare "R2". Series header rows group round columns (`2027 VS · AC CAPI` over `R1 R2 R3`); mixed cycles get one group per series; pipe headers spell out the order (`22 AC CAPI R4 | 27 AC CAPI R2 | 27 AC CAPI R3`); the context bar shows `2027 VS AC CAPI · R1–R3`. Hovering any round label shows full identity, version, fieldwork period, coverage and dataset. Admins may assign friendly round names in the registry.

**Headline values / sparklines:** big numbers show the anchor round only, with Δ vs the compare round and a sparkline over all rounds; sparklines break visibly between series or cycles.

**Conditional formatting** (`Format ▾` on any table)

- Rules: heat scale, diverging (Δ), data bars, threshold, leader in row, top/bottom N, sign colours.
- Apply to: anchor-round value, Δ part, all rounds, selected party.
- Scale within: each column, each row, whole table.
- Threshold examples: share ≥ 40 → bold; Δ ≤ −3 pp → red fill; base below preset floor → hatched (only if a floor is set, §20).
- Never changes values or totals; legend always shown; saved with the card; template defaults come from the registry; formatting follows the data through transpose.

**Sorting** by a chosen cell part. **Export:** CSV flattens composite cells into separate columns (e.g. `share_27R3`, `delta_27R3_vs_22R4`, `base_27R3`); PNG/SVG of tables and charts include round labels, coverage note and method version.

## 9. Presentation rules registry

Data, not code. Layers: `global → state → card override`.

- Targets: dimension values, parties (canonical alliance labels), opinion answer options (default order from the engine scale), measure columns, round friendly names. Round order itself is not editable.
- Rule content: value order, `within` (e.g. castes inside a category), pinned first/last (wildcards such as `Other *`), labels, hidden values, colours (one colour per canonical party label everywhere), default placement (rows/columns), `unknown` policy (`append_end | append_alpha | append_by_base`).
- Values without a rule are appended, never dropped. "Hidden" only hides display; cards say "N values hidden".
- Multi-state: global order first, state-only values appended in state order.
- Applied server-side in the result normaliser (sort index, label, colour per value). Versioned; the version is shown in the method drawer.
- Storage: reviewed YAML in the app repo, loaded into the app DB with a reload endpoint; an admin editing UI arrives with the access-control phase.

## 10. Charts

- One normalised result shape for all operations: `state · round{label, order, version, borrowed} · dimensions{value, is_subtotal, sort, label} · series · measure · value · unit · base{weighted, raw} · flags`.
- Chart settings are stored separately from datacuts; templates set a default; users switch only among compatible charts (fit rules).
- Starting set: round table (default), grouped/100% stacked bar, slope/line, diverging bar, dot plot, KPI row, margin histogram, seat-count strip, flip 2×2, rank list/bump chart, matrix heatmap, Sankey, seat map (needs GeoJSON).
- Rendering rules: NULL is not zero; units (% vs pp) and signs explicit; no browser-side totals; bases in tooltips; borrowed/hidden/coverage notes carried into chart footers; registry colours; colour-blind-safe palettes.
- Libraries: Apache ECharts (charts, maps, Sankey), TanStack Table (tables). Adding a chart type = one adapter + fit rules.

## 11. Guided builder ("Add a cut")

Side panel, six steps, each limited to valid options via `/cards/plan`:

1. **Question** — grouped: Vote, Leaders, Governments, MLA/MP, Local issues (survey-specific miscellaneous questions).
2. **Measure** — support / composition / gender gap / net score…, filtered by question type.
3. **Slice by** — up to two dimensions or a cascade; geographic options follow the level; saved segments (conditional variables) available.
4. **Compare** — delta vs the compare round, or vs another question (e.g. Shakti, candidate vs party).
5. **Filters** — respondent or seat-attribute, as the operation allows.
6. **Preview & save** — live plan check, run, save to a section or My cards.

## 12. Config compiler

Pure function: context + card instance + template + preset + catalogue → **run plan** (engine configs + fingerprints + join spec). No I/O beyond the catalogue.

1. Resolve rounds to dataset names (version mode; fallback recorded); assign unique readable round labels.
2. Validate: same level, capability table, per-round availability (missing → "not asked" columns, not whole-card failure).
3. Expand slice presets to grouping sets (e.g. `caste_cascade` → `[[], [category], [category, caste]]` + caste clubbing with an explicit reference round = latest selected); route filters to the request (respondent) or to ranking/benchmark (seat attributes).
4. Apply the method preset (weights, answers, alliances, opinion weights, gender labels).
5. Coverage per §6.
6. Fan out by operation:

| Operation | Runs |
|---|---|
| Distribution, opinion, gender gap, relationship | 1 per state, all rounds as observations |
| Delta / compare-with | added as `comparisons` to the same request |
| Seat or demographic ranking | 1 per (state, round) |
| Benchmark seat counts | 1 per (state, round, level); Δ via a paired benchmark (anchor vs compare) |
| Benchmark vs actual election | 1 per (state, round) against the same election |
| Entity selection | upstream once; downstream with all rounds |
| Party scoreboard | distribution + comparison, AC and PC benchmarks, gender gap — joined on canonical party |

7. Fingerprint each config (canonical JSON + metadata revision + engine version + alliance-resolution version).
8. Emit the join spec: keys `state, round label, dimensions, party/option/seat`; coverage notes; borrowed markers.

Tests: snapshot tests UI state → engine JSON, each validated with the engine's `resolve` on mocked metadata.

## 13. Backend: API, jobs, cache

- **API (FastAPI):** stateless; catalogue, templates, plan, queue runs. Never runs heavy queries itself.
- **Workers (2–4 processes to start):** each owns one `NamedSurveyRuntime` + `MetadataSession` + its own ClickHouse/MySQL connections (read-only users).
- **App DB (Postgres):** templates, custom templates, saved cards, notes, presets, display rules.
- **Redis:** job queue and result cache.

| Endpoint | Purpose |
|---|---|
| `GET /catalogue/states` | states visible to the caller (future state-level access hook) |
| `GET /catalogue/{state}/surveys` | datasets grouped by cycle/series/level, variants, availability, coverage counts, revision |
| `GET /sections`, `/templates`, `/presets`, `/presentation-rules` | frontend/builder configuration |
| `POST /cards/plan` | dry run: validation, greyed reasons, not-asked rounds, coverage mode |
| `POST /cards/run`, `/cards/run-batch` | queue one card or a section; cache hits return immediately |
| `GET /runs/{id}` | status, per-run progress, normalised result + contract (poll every 1–2 s) |
| `/custom-templates`, `/saved-cards`, `/notes` | CRUD |
| `POST /admin/metadata/refreshed` | `session.clear()` on all workers; invalidate the cache |

- **Dedup:** identical fingerprints share one job across cards and users.
- **Cache key:** fingerprint + metadata revision + engine version + alliance-resolution version, plus a time-based expiry and manual refresh (expiry value open, §20).
- **Limits:** global cap on concurrent engine queries (e.g. 4–6); 120 s timeout and max result rows as in the CLI; on-screen cards prioritised; per-user fairness. Cancellation drops queued jobs only.
- **Security:** credentials only in the worker environment; read-only DB users; users never send SQL (engine JSON only, strictly validated); every request carries a "who is asking" context (no-op until phase 4).

## 14. Frontend shell

- React + TypeScript, Vite, TanStack Query, URL-backed router; component library chosen in visual design (Mantine or shadcn/ui).
- **Context bar:** collapsed one-liner (e.g. `UP · AC level · 2027 VS AC CAPI · R1–R3 · Δ vs R2 · Extrapolated · Focus: none · Geo: whole state`); expanded editor with states, level, rounds, compare round, version mode, focus party, geo scope.
- **Left nav:** five sections, My cards, "+ Add a cut"; later Admin.
- **Card anatomy:** header (title, round labels, coverage badge); toolbar (Question, Slice, Rows/Columns/Cell, Show preset, Filters, Format, Table/Chart, ⋯; wraps onto two lines); body; footer (coverage, not-asked, hidden values, borrowed legend, method preset).
- **Behaviour:** context change → plan all visible cards (instant greying) → queue valid runs; skeletons with progress ("6 of 10 runs done"); the previous result stays visible, dimmed, until replaced.
- Desktop-first, tablet-readable, phone read-only for saved cards.

## 15. Multi-state views

- The context holds a list of states; each state has its own level, rounds and compare round.
- One run set per state; state is a dimension in every row; seat keys are `(state, ac_num)`.
- Rounds are matched per state (latest vs previous), never "R2 vs R2" across states.
- Parties are state-specific; cross-state cards may need a mapping layer (e.g. "main NDA rival").
- No pooled national numbers until a weighting rule is agreed (§20).
- Mixed levels drop to the finest grain all selected states support (usually statewide), with a note (to confirm, §20).

## 16. Errors and monitoring

| Type | When | Card shows | Retry |
|---|---|---|---|
| Not available | plan time | greyed + reason | — |
| Valid but empty | `no_eligible_result` | "No respondents match these filters" | — |
| Configuration/metadata | engine rejects (missing factor, alliance ambiguity, duplicate master, unknown field) | short message + engine message in drawer; admin alert | no |
| Too heavy | `TOO_BIG_AST`, timeout, row limit | "This cut is too heavy" + suggestions | no |
| Infrastructure | connection/worker failure | retrying | up to 3 with backoff |
| Partial | one per-round job fails | other rounds shown, failed column marked; the whole card fails when all rounds are required (delta, common coverage) | per job |
| Metadata cache full | session capacity | admin alert; no silent eviction | no |

No tracebacks reach users; failures are logged with the config fingerprint (reproducible via the engine CLI). Structured logs and OpenTelemetry metrics (queue wait, engine time, rows, cache hit, versions). No respondent data in logs.

## 17. Testing

| Layer | Tests |
|---|---|
| Compiler | snapshot UI state → engine JSON per capability row, version fallback, coverage choice, fan-out, cross-cycle, multi-state; validated with the engine's `resolve` on mocked metadata |
| Normaliser/joins | NULL vs 0, subtotal flags, borrowed markers, not-asked columns, composite cell assembly, multi-state merge |
| Presentation registry | layering, unknown values appended, cascades, multi-state merge, no drops |
| API | contracts, dedup, cache keys per revision, priority, retries |
| Numerical end-to-end | card → API → real engine → `chdb` fixtures with discriminating data (support vs composition, subtotals, filter stage, PC pooling, Δ sign, borrowed seats), hand-calculated expectations |
| Frontend | Vitest + Testing Library: card states, cell parts, density, transpose, formatting, fit rules, builder |
| Journeys | Playwright: context change, drill-down, builder → save, multi-state |
| Live smoke | manual read-only checklist against production; never run fixture-creating tests on production |

Performance targets are set jointly (§20).

## 18. Access control (phase 4)

State-level access (which states a user sees) and configuration-level access (who may create, edit or only view templates, presets and rules). Hooks exist from v1: a request principal context, a single catalogue/card filtering step, owner/scope fields on templates and presets.

## 19. Phases

1. **Phase 1:** repo setup; backend skeleton (catalogue, compiler, workers, cache); frontend shell and context bar; composite-cell table component; **State Pulse end to end**.
2. **Phase 2:** Seat Battleground, Voter Coalitions, Leadership, Vote Movement.
3. **Phase 3:** guided builder, My cards, notes, view-data tab.
4. **Phase 4:** cross-state views, then access control.

Before phase 1: visual design (wireframes updated for §8, then polished design) and an implementation plan.

## 20. Open decisions

**These change numbers**

1. Alliance mapping for older-cycle surveys: keep current (engine today) or add time-of-survey mapping (engine change).
2. Method preset values per state (weights, invalid/zero, answer exclusions, keep list, caste threshold/reference, opinion weights, gender labels).
3. Low-base flag threshold (none by default).
4. Uncertainty / margin-of-error display: requires an approved method; none until then.
5. Whether seat-attribute axes (party zone, district) trigger coverage alignment under the engine's coverage rule.

**Product and operations**

6. Result-cache expiry while surveys are in the field.
7. Cross-state mixed-level fallback (finest common grain) — confirm.
8. Series mixing (CAPI/CATI/REBEL) — confirm "allowed but labelled".
9. Seat-map boundary GeoJSON availability per state.
10. Performance targets (section load, concurrency).
11. Pooled national figures: weighting rule, if ever needed.
12. Repo hosting and deployment environment.

## 21. Engine and metadata follow-ups

1. Commit the `coverage_mode: common` change in the engine repo (currently uncommitted).
2. Publish the detailed weighting level (distinguish AC zone vs PC zone) and `data_level` in survey metadata; add district/vibhag levels to collation and the engine.
3. Optional: tag engine queries with IDs to allow cancelling running ClickHouse queries.
4. Optional: store series name as an explicit metadata column instead of parsing survey names.

## 22. Wireframe status

The Figma file shows frames A (State Pulse, AC level), B (state-level survey), C (context editor), D (round labels across cycles, transpose) and E (question selector, compare-with, many rounds, conditional formatting), with numbered notes 1–32. Updated 2026-11-09 for §8: frame A's lead is the Party scoreboard with composite cells (vote share, seats AC · PC, gender gap) and an open Cell picker; leader scorecard, change appetite and party-zone tables use composite cells, with diverging formatting on the zone Δ part. Frame E's 7-round tiles still show the older tile treatment (illustrating sparkline series breaks); frames B and D still use plain round tables.
