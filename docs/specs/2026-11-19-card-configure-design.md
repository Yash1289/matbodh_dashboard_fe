# Card configure (sub-project 6a) — design

Date: 2026-11-19. Status: draft for owner review.
Repos: `matbodh-dashboard` (all of the work; the plan found no engine change was needed, section 7.3).
Ledger: every decision below that opens, closes or changes an item is recorded in `docs/open-items.md` in the same change.

## 1. Intent

Every analyst builds the cards they need, for their own use case, instead of waiting for someone
to add them to `config/cards/cards.yaml`. A card is configured inside the card: the analyst adds a
card, picks its type, and then sees only the options that apply to what they have chosen so far.
Analysts know the domain; the goal is no choice overload at first glance, not hand-holding.

Card configurations are real work, not throwaway: in a later phase they are stored in a database
against the analyst's login. Until then they live in the browser (section 9).

This is part **6a** of sub-project 6. The whole sub-project, in build order:

| Part | What | Status |
|---|---|---|
| **6a** | Card configure: the per-card configuration, its option lists, validation, and running a card from its own config | this spec |
| 6b | Canvas and tabs: add, place and resize cards; tabs (like sheets) holding different sets of cards | brainstorm after 6a |
| 6c | Context step and saving: one context for all tabs; workspace kept in the browser until the DB phase | brainstorm after 6b |

The end-goal user flow (owner, 2026-11-19): set the context once (anchor round, comparison round,
pipe rounds and the rest) → a blank canvas → add cards, place and resize them, organise them in tabs
→ configure each card in place. Any card can be copied and tweaked. Commonly used cards may exist as
pre-configured library cards the user simply picks.

## 2. Goals, non-goals, anti-goals

Goals
- Every per-card engine input of the seven families is configurable (inventory, section 5),
  including the capabilities the dashboard did not expose before: hide parties (`display_parties`),
  Shakti, benchmark contenders, relationship joint weights from a scenario. (Seat segmentation is
  deferred, section 5.9.)
- Options appear only when they apply (progressive disclosure, section 6.3).
- Every option list comes from real metadata for the current context: a user cannot pick a field,
  scenario, party, value or election the selected surveys do not have.
- One rulebook: the backend's `CardConfig` plus the engine plan decide validity; the frontend never
  re-implements a rule.
- A card runs from its own config (no `cards.yaml` id needed); copy a card; copy its config.
- Adding a card type later costs a descriptor (data) in the common case, not a new form.

Non-goals (this part)
- The canvas, placement, resizing and tabs (6b); the context step and workspace persistence (6c).
- Derived categories (engine `conditional_variables`): deferred by the owner. Nothing here may block
  adding them later as one more widget plus descriptor entries (section 6.4).
- A per-card override of the whole context (owner: later idea, not now).
- A publish-to-library action: library cards are added by pasting a copied config into `cards.yaml`.
- Persistence in a server database and access control (last phase).
- The visual design of the configure surface: part of the frontend is being redesigned; this spec
  fixes behaviour, data and contracts, not the look.

Anti-goals (would be a failure even if it works)
- A wall of options on first open.
- The frontend holding its own copy of a validation rule, which then drifts from `CardConfig`.
- An option that, when picked, produces an engine error the configure surface could have prevented
  with metadata it already had.
- Exposing method policy (weights, answer handling, alliance mapping, thresholds) to analysts.
- Inventing values: option lists come from metadata or the engine, never hard-coded lists of
  castes, zones, parties or elections.

## 3. Constraints

- Dashboard invariants (dashboard `CLAUDE.md`): the engine owns every number; NULL is never zero;
  read-only database access; series-qualified round labels; one `formatPercent`.
- Engine rules (`MatBodh-Dash/CLAUDE.md`, `docs/usage.md`): ClickHouse computes; Python validates and
  orchestrates; FINAL, final_valid=1 and readiness (status=1) apply to every read; filter values are
  reporting values; `in`/`not_in` filters exclude NULL; no invented availability, mappings or encodings.
- Method policy belongs to the owner's preset (`config/presets/*.yaml`, Q-8): weights, answers,
  party identity and alliance mapping, Other grouping (`keep`), opinion weights, caste-clubbing
  threshold, gender labels, `competition_excluded`, geography path, coverage mode, snapshots.
  The single exception the owner chose: relationship joint weights from a scenario (section 5.7).
- Party scenarios without embedded weights stay excluded wherever an external binding would be
  needed (Q-11 open); option lists apply the same rule (`party_scenarios_of`).
- `cards.yaml` ships empty (owner). The library endpoint stays; tests and the smoke script must not
  depend on the production file (section 10).

## 4. Context the card reads (owner decisions)

The context is set once and holds for every tab: state, survey level, **anchor round**,
**comparison round**, **pipe rounds**, version mode, and the session cohort. The comparison round is
one of the pipe rounds; the anchor is always among the pipe rounds. Today's `StateContext`
(`rounds`, `anchor_round`, `compare_round`) already means exactly this; no new context concept.

How a card uses it:
- standalone → the anchor round;
- compare → anchor vs comparison round, or two scenarios inside the anchor round (intra-round);
- trend / pipes → the pipe rounds (seat-ranking trend and relationship matrices too).

Per-card pipe rounds (in scope): a card may read fewer pipe rounds than the context holds. It stores
a **count**, `pipe_rounds: N`, meaning "the last N pipe rounds up to and including the anchor" in
round order. A count follows the context when it changes (new round arrives, a round is dropped,
another series is chosen); stored names would go stale. If N exceeds what the context has, the card
reads all of them and says "showing 2 of the 3 rounds asked for" (in 6a in the configure summary and
plan response; the card footer shows it with the canvas redesign in 6b). A windowed card's payload
lists only the rounds it read. Default: all pipe
rounds. The existing rules still apply after the count: rounds that did not ask the scenario are
dropped and listed as not asked; trend needs at least 2 rounds; at most 4 trend rounds (if the
result is above 4 the card is unavailable with a reason naming the count to lower).
Should non-contiguous picks ("R1 and R4") ever be added, a named round that leaves the context is
dropped from the card silently (owner rule).

## 5. Per-card inputs (the inventory)

Built from `MatBodh-Dash/docs/usage.md`, `sample-output/configs_v2` and the output shapes.
"New" marks capabilities `CardConfig` does not accept today.

### 5.1 Party distribution (`distribution`)
Required: one or more party scenarios (or "all party scenarios of the anchor round").
Optional: cuts; filters; mode (standalone, compare, trend; trend needs exactly one scenario);
pipe-round count (trend); caste clubbing (shown only when a cut contains caste);
**hide parties — new** (`display_parties`: the parties to keep showing, chosen from the party rows
the card actually has — `preset.keep` plus the preset's Other label; filters rows after
calculation, never the population). Gender differential has the same option.

### 5.2 Opinion (`opinion`)
Required: one or more opinion scenarios (rating or yes/no).
Optional: cuts; filters; mode; pipe-round count (trend); delta measure for compare
(positive, negative or net share). **Shakti** is a compare with a party target and an opinion
reference: `CardConfig` already accepts it (`comparison_kind`); 6a makes it configurable (section 6.3).

### 5.3 Gender differential (`gender_differential`)
Required: party scenario(s). Optional: cuts (gender never offered); filters; standalone or trend;
pipe-round count. No compare.

### 5.4 Seat ranking (`seat_ranking`)
Required: seat level (AC or PC, limited by the survey level); scenario + metric
(support share for party scenarios; positive/negative/net for opinion); party (party metrics only,
from `preset.keep`). Optional: compare (rank the change; Shakti allowed); trend (rank pipes,
pipe-round count); partition by seat attribute; seat-attribute filters; top K.

### 5.5 Demographic ranking (`demographic_ranking`)
Required: level (a single-valued profiling field available in the rounds); scenario + metric; party
(party metrics only); top K 1–5. Optional: partition (geographic/master axes); respondent filters;
compare.

### 5.6 Seat benchmark (`seat_benchmark`)
Required: party scenario. Optional: **reference** (none, the comparison round, or a past election
year + LS/VS) — moves from a card-level request parameter into the card config (section 8.2);
focal party (alliance majors mapped for every endpoint); grouping by seat attributes;
**contenders shown — new** (a subset of the alliance majors, default all; the focal party must be
among them). Verified in the engine (`matbodh_dash/benchmarking.py`): winners are decided over all
parties before display; a major left out of contenders still wins its seats and its votes and seats
fold into the Other row of summaries (Other = everything not displayed, so totals still add up);
focal margins and flips are unchanged (opponent = strongest other party, including unlisted
majors); seat-level rows list only contenders. Keep `other_grouping.keep` = all majors;
contenders alone narrow the display;
Benchmark seat filters (`benchmark.filters`) are not offered in 6a (owner, 2026-11-19);
the compiler keeps sending none.

### 5.7 Relationship (`relationship`)
Required: origin and destination party scenarios (different). Optional: focal party (alliance
majors); include "Did Not Vote" / "Do Not Remember" (shown only on a recalled side); cuts; pipe-round
count; **joint weights from a scenario — new** (engine `weights: {source: scenario, scenario, mode}`;
options: party scenarios with embedded weights present in every round the card reads; `mode` comes
from the preset's weight mode, not chosen by the analyst). Default stays the base joint weight.
This **replaces** the sub-project 5a owner decision "base joint weight only"; record the new
decision in the ledger and reference the old one.

### 5.9 Seat segmentation — deferred

Dropped from 6a (owner, 2026-11-19); designed later. In 6a the seat-type attributes `ac_type`,
`ac_score`, `pc_type`, `pc_score` are never offered in any option list, and no segmentation config,
preset key or election flag is added.

Facts gathered for the later design: for each past election (year + LS/VS) every AC and PC has a seat
type (Safe, Favorable, Battleground, Difficult) and a seat score, in MySQL table
`acDashboard_retrosegement` (engine `mysql_access.py`); available only from NDA/BJP+'s point of view,
for every election (owner); the engine needs the election (`ranking_segmentation`, or benchmark
`segmentation_context` + `segmentation_party`, which must equal the focal party) before it reads
those attributes; seat ranking and benchmark only. Proposed shape: offer seat type as a seat
attribute with a "Seat type from" election picker.

### 5.8 Shared inputs
- Cuts: a list of independent grouping sets; each set is a list of fields crossed together; `[[]]`
  is Overall; no duplicate grains (existing `CardConfig` rule).
- Filters: several at once, AND-combined, `in`/`not_in`, nonempty string values, one filter per
  field; NULL values never match (engine).
- Compare endpoints (grid and ranking compare): each endpoint is a round choice and a scenario. The
  round choice is `anchor` or `compare` only (the context decides which rounds those are; picking
  a named round is not offered, consistent with section 4). Same round + different scenarios is an
  intra-round compare.
- Title (free text) and family; `id` is generated (section 8.1). `section` and `requires.min_level`
  are not shown: `section` becomes optional (the canvas replaces sections) and `min_level` keeps
  its default `state`; the compilers already check seat levels (`ac` would block PC-level surveys).
- Display choices (lenses, benchmark table, relationship summary/matrix, density, sort) are NOT
  configure inputs: they stay on the card and never re-run the engine (earlier decision; `view` is
  never fingerprinted).

## 6. Approach

### 6.1 Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | The backend publishes a configure **descriptor** per family (fields, widget kind, required, show-when conditions, option source) and a validate endpoint; the frontend has one generic renderer over ~8 widget kinds | Rules, options and visibility live beside `CardConfig`; the redesign only re-skins widgets; a new card type is mostly data. Costs a small condition vocabulary up front and a custom slot for unusual layouts |
| B | A hand-built React form per family; backend validates and supplies options | Fastest first family and full UX control; seven forms each duplicating visibility rules, rebuilt in the redesign |
| C | Generate forms from `CardConfig`'s JSON Schema | Cheapest start; conditional fields and friendly widgets are awkward, giving the choice overload the owner wants to avoid. Rejected |

Owner picked A (2026-11-19) after weighing the cost of adding a novel card type later: tier 1
(existing widget kinds) is a descriptor plus `CardConfig` rules and no frontend configure code;
tier 2 a new widget, reusable; tier 3 a new condition kind; tier 4 a custom slot for that one family.

### 6.2 The descriptor

`GET /configure/families` returns one descriptor per family (static per deploy; cached by the
client). A descriptor is data, built in Python next to `CardConfig` (for example
`matbodh_dashboard/cards/configure/descriptors.py`), never a second copy of the rules: a test asserts
every `CardConfig` field a family accepts has a descriptor entry or is listed as display-only or
generated, and every descriptor path exists on `CardConfig`.

Per field:
- `path` — the dotted `CardConfig` path it writes (`scenarios`, `rank.metric`, `benchmark.contenders`…);
- `label`, optional one-line `help`;
- `widget` — one of the kinds in section 6.4;
- `required` — boolean;
- `tier` — `primary` (shown on first open) or `more` (behind "More options");
- `show_when` — a condition (section 6.3); absent means always shown;
- `options` — an option source (section 7) with its parameters, for picker widgets;
- `default` — optional; for example pipe-round count = all, joint weight = base;
- `limits` — for numbers/lists (top K 1–5, at most N scenarios), mirroring `CardConfig`; the backend
  still validates.

Field order in the descriptor is display order. First open shows the family's `primary` fields only:
what the card measures (scenario/metric), how it is split (cuts or level), and its mode. Everything
else is `more`.

### 6.3 Show-when conditions (vocabulary)

Kept deliberately small; evaluated by the renderer on the draft, emitted by the backend:
- `equals {path, value}` / `in {path, values}`;
- `nonempty {path}`;
- `contains {path, value}` — a list (or list of lists, e.g. cuts) contains the value;
- `kind_of {path, kind}` — the scenario at `path` is of kind `party` / `opinion` / `recalled`
  (kinds come with the scenario option list, so the renderer never needs the catalogue). A recalled
  scenario is a party scenario: `kind_of party` matches it, `kind_of recalled` matches only recalled;
- `count_at_least {path, n}`;
- `all [..]`, `any [..]`, `not {..}`.

Examples (normative):
- caste clubbing: `contains {cuts, "caste"}`;
- delta measure: `all [equals {comparison.mode, compare}, kind_of {comparison.reference.scenario, opinion},
  kind_of {comparison.target.scenario, opinion}]`;
- Shakti is not a separate toggle: choosing a party target and an opinion reference in compare *is*
  Shakti; the renderer labels the comparison "Shakti" when
  `all [kind_of {comparison.target.scenario, party}, kind_of {comparison.reference.scenario, opinion}]`;
- party for ranking: `kind_of {scenarios.0 or comparison.target.scenario, party}`;
- include recalled (origin): `kind_of {relationship.origin, recalled}`;
- pipe-round count: `equals {comparison.mode, trend}` (grid, ranking); always for relationship.

A field hidden by its condition is removed from the draft before validation and saving (no hidden
values linger).

### 6.4 Widget kinds

`scenario_picker` (single/multi; shows kind), `metric_picker`, `cut_builder` (list of grouping sets;
each a multi-select of fields; Overall toggle), `filter_list` (rows of field + in/not in + values),
`party_picker` (single/multi), `election_picker` (year + LS/VS), `number`, `toggle`, `choice`
(fixed small enumerations from `CardConfig` literals, e.g. mode, seat level, recalled statuses), and
`slot` (a family-specific component named in the descriptor, for layouts the generic kinds cannot
express; none required by 6a, available for later). Derived categories will add one kind
(`rule_editor`) and make derived fields appear in field option lists; nothing in 6a closes that path.

### 6.5 Draft, validate, apply

- The configure surface edits a **draft**. Changing a field never runs the engine.
- After each change (debounced, ~400 ms) the client calls `POST /cards/validate` with the draft and
  the context; it returns field-level errors and plan-level unavailability (section 8.3). Errors show
  next to their field; unavailability shows as a summary with reasons (for example "Scenario
  'cm_satisfaction' was not asked in 2027 VS CAPI R1").
- **Apply** is enabled when the draft is valid and has no unavailability; it replaces the card's
  config and runs it. Cancel discards the draft.
- When an upstream choice changes and a dependent value is no longer offered (for example a filter
  value not present in the new rounds), the value is kept but flagged by validation, never silently
  dropped by the client.

## 7. Option sources

`POST /configure/options` with `{source, params, card: <draft>, context}`. The draft is sent so the
backend computes the **rounds the card reads** with the same selection the compilers use (mode,
pipe-round count, chosen scenarios, benchmark reference). All lists are computed
from the catalogue already in memory unless stated. Each item carries `value`, `label` and, where
relevant, `kind` or a `reason` it is disabled (shown, not hidden, when that helps: for example a
scenario present in the anchor but not in every pipe round, disabled for trend).

### 7.1 From the in-memory catalogue (no new query)
- `scenarios?kind=party|opinion&scope=anchor|all_read` — `DatasetVersion.scenarios` of the anchor
  (or every round the card would read); kind from the engine scenario catalogue
  (`scenario_kind`, `role` for recalled); party scenarios filtered by `party_scenarios_of` (Q-11).
- `fields?use=cut|filter|level|partition|seat_attribute` — `field_available` over the rounds read,
  limited by the capability table (`template_blockers` geo slices per survey level); `seat_attribute`
  = master fields (`default_fields()` with `source == "master"`); gender excluded for gender
  differential cuts; `level` = single-valued profiling fields.
- `joint_weight_scenarios` — party scenarios with embedded weights present in every round read.
- `metrics?scenario=` — support share for party; positive/negative/net for opinion.

### 7.2 From existing lookups
- `parties?use=focal|contenders|hide|rank` — focal/contenders: alliance identities for the state
  (`MajorPartyProvider`, cached per alliance epoch); for benchmarks the union over endpoints (so they
  depend on the reference) and the "mapped for every endpoint" check as today; `hide` = `preset.keep`
  plus Other (the grid's party rows; no alliance lookup); `rank` = `preset.keep`.
- `elections` — `config/elections.yaml` for the state (UP only today; other states list none, Q-7).

### 7.3 Filter values (amended in the plan: no engine helper; an ordinary engine distribution job cut by the field, cached by fingerprint, D-K6)
`filter_values?field=` returns the distinct **reporting** values of a field across the rounds read.
Values must be reporting-mapped and respect FINAL, final_valid and readiness, so they cannot come
from the reporting-mapping table alone (it lists mapped columns only) and the dashboard must not
write SQL. Add a small read-only engine helper (in `MatBodh-Dash`) that, for a resolved observation
and one field, builds the prepared-response CTE with the existing builder and returns
`SELECT DISTINCT` values (no weights, no counts). Master fields (zone, party_zone, district, seat
type…) return their values from the master snapshot the engine already loads. The dashboard calls the
helper through the worker/session it already owns, caches per (dataset_id, field, metadata revision),
and returns the union over rounds, sorted naturally, with NULL never listed. Numerical
correctness is unaffected (values only); still covered by engine tests on fixtures.

## 8. Backend changes

### 8.1 Run a card from its own config
- `CardRequest` (`/cards/plan`, `/cards/run`) and `PreviewRequest` (`/cohorts/preview`) accept
  **either** `card_id` (library card) **or** `card` (a full `CardConfig`), never both.
- An inline card is validated by `CardConfig` at the API boundary (trust boundary: strict model,
  `extra="forbid"` already; add size limits — at most 12 scenarios, 8 cuts, 8 filters, 200 filter
  values, 200-character title) and gets an `id` generated by the client (stable per card, used only
  for logs and React keys; never part of the engine config or fingerprint — engine ids are already
  constants).
- `CardRunService` gains a path that takes a `CardConfig` instead of looking one up; `_Run.card_id`
  logs the client id. Caching is unchanged: fingerprints come from the compiled engine config, so two
  analysts with the same card share a cached result.

### 8.2 `CardConfig` additions
- `pipe_rounds: int | None` (≥ 1; None = all) — section 4; applied in the round selection for grid
  trend, ranking trend and relationship.
- `display_parties: list[str]` — distribution and gender differential only (engine clears it for
  ranking, benchmark, relationship); values must be in `preset.keep` or the Other label.
- The ranking operation `id` becomes the constant `"ranking"` (today it is the card id, which would
  put client ids into fingerprints, including cohort previews).
- `benchmark.reference: {kind: none|compare|election, year?, election_type?}` — default `compare`;
  the request-level `reference` parameter is removed once no client sends it.
- `benchmark.contenders: list[str] | None` — None = all majors; must include the focal party.
- `relationship.joint_weight: {source: base} | {source: scenario, scenario}` — default base.
Each addition gets its `CardConfig` rule and compile wiring with numerical fixtures that would catch
a wrong wiring (for example contenders hiding a major that still wins seats).

### 8.3 `POST /cards/validate`
Body: `{card: <draft>, context}`. Response:
`{valid, errors: [{path, message}], unavailable: [{reason}], not_asked: [...], rounds: [...]}`.
Pydantic `loc` maps to descriptor `path`s; errors raised by model-level validators without a field
are attached to the most specific path the validator names (each validator states its path) or to
the card as a whole. Then, only if the model is valid, the plan is compiled (no engine run) and its
`unavailable` / `not_asked` returned, reusing `/cards/plan`'s logic.

### 8.4 Endpoints summary
`GET /configure/families`; `GET /configure/{state}/options/{source}`; `POST /cards/validate`;
existing `/cards` (library, may be empty), `/cards/plan`, `/cards/run`, `/cohorts/preview` extended
per 8.1.

## 9. Frontend (behaviour only)

- One configure renderer driven by the descriptor; widgets as in 6.4; option lists via TanStack
  Query keyed by (source, params, context).
- "Add card": pick a type (the seven families with plain names and one-line descriptions), or pick a
  library card from `/cards` (shown only when the library is not empty). Picking a library card
  places a **copy** of its config (new id) that the analyst may edit; later changes to `cards.yaml`
  do not touch existing copies (owner, 2026-11-19). Then the configure surface opens on the new card.
- "Copy card" duplicates a card (new id, same config). "Copy config" puts the card's validated
  config, including its `id` (which `load_cards` requires), as one YAML list item ready for
  `cards.yaml`, on the clipboard.
- The benchmark card's on-card reference picker is removed: the reference is part of the config
  and shown read-only on the card.
- Until 6b/6c exist, configured cards live in a minimal per-state list in `localStorage`
  (key `mb.cards.<state>`), each entry `{id, config}`; storage access wrapped in try/catch with an
  in-memory fallback. 6b replaces the list with the canvas; 6c defines the workspace format and its
  move to the database. The stored config is exactly the backend-validated `CardConfig` shape.
- The session cohort keeps applying to every card as today (`StateContext.cohort`); a cohort is never
  part of a card config. "Make cohort" works on analyst cards via the inline-card preview (8.1).

## 10. Library and tests

- `config/cards/cards.yaml` ships with `cards: []`. The seeded cards move to a test fixture file used
  by backend tests, the fixture exporter and the smoke script (`--cards` path option).
- Backend (pytest): descriptor/`CardConfig` parity; each condition kind; each option source on
  catalogue fixtures (including disabled reasons and Q-11 filtering); validate endpoint path mapping;
  inline-card run/plan/preview including size limits and the "both or neither" rejection; each new
  `CardConfig` field's rule and compile output; `pipe_rounds` cases from section 4 (new round,
  dropped round, N larger than available, scenario not asked, more than 4); fingerprint unchanged by
  card id and title.
- Engine (unittest): the filter-values helper on fixtures — reporting-mapped values, NULL excluded,
  FINAL/final_valid/readiness applied, master field values.
- Frontend (vitest): renderer shows only primary fields first; show-when for each normative example;
  hidden fields removed from the draft; debounced validate; Apply disabled with errors; copy card and
  copy config; localStorage fallback. Playwright (stubbed API): add a card, configure it, apply, copy.
- Live checks only with the owner's go-ahead (VPN): one card per family configured end to end, plus
  each new capability once.

## 11. Decisions made in this design (owner unless marked)

- Configure for every family, including hide parties, Shakti, contenders and scenario joint
  weights; derived categories and seat segmentation later (owner).
- Approach A: descriptor + generic renderer + validate endpoint (owner).
- Context: anchor, comparison and pipe rounds global for all tabs; per-card pipe-round count;
  per-card full context override later (owner).
- Pipe rounds stored as a count, last N up to the anchor (proposed, owner agreed); silent drop rule
  for any future named picks (owner).
- `cards.yaml` empty; library cards added by pasting copied config (owner).
- Picking a library card gives the analyst a copy, not a live link (owner).
- Scenario joint weights replace the 5a "base only" decision (owner, via the capability choice).
- Engineering calls (this spec): method policy stays in the preset; display choices stay off the
  configure surface; draft + Apply instead of live runs; benchmark reference moves into the config;
  filter values via an engine helper; client-generated card ids excluded from fingerprints;
  size limits on inline cards; seeded cards move to a test fixture.

## 12. Left to the builder

- Exact descriptor JSON field names and the module layout.
- Natural sort order for values and the disabled-reason wording.
