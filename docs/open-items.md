# Open items and decisions ledger

The single living list of small pending items and small decisions for the dashboard. Update it in the same change that opens, closes or decides something; never delete a row, move it to "Closed" with the date and commit. Larger designs live in `docs/specs/` and `docs/plans/`; this file only points to them.

IDs are stable: `O-` open item, `Q-` question for the product owner, `D-` decision. Owners: **owner** = product owner decides; **eng** = engineering can just do it; **engine** = needs a MatBodh-Dash change; **infra** = environment or DevOps.

Last reviewed: 2026-11-18.

## 1. Roadmap

| # | Sub-project | Status |
|---|---|---|
| 1a / 1b | Backend + frontend platform | Done |
| 1 | Card foundation + grid cards (distribution, opinion, gender differential) | Done |
| 2 | Runner fan-out | Folded into 3 |
| 3 | Seat and demographic ranking | Done, live-verified |
| 4 | Benchmark (`seat_benchmark`) | Done, live-verified (UP) |
| 5a | Relationship cards | Done, live-verified |
| 5b | Seat cohorts (session-only) | **Built on branch feat/seat-cohorts, not merged; live check and PC cross-round membership (O-C5) still open** |
| 6 | Configure modal, Duplicate card, live option lists | Not started |
| last | Access control (Postgres, state + configuration permissions) | Not started |

## 2. Open items

### 2.1 Cohorts (5b)

| ID | Item | Owner | Status |
|---|---|---|---|
| O-C1 | Where cohort creation starts: DECIDED 2026-11-18, from the seat ranking and benchmark cards themselves (D-C5) | owner | BUILT 2026-11-18 (Tasks 5, 6, 8) |
| O-C2 | ~~Cohort naming, provenance and edit rules~~ DROPPED 2026-11-18: cohorts are session-only, no names, no edit (D-C8) | owner | dropped |
| O-C3 | ~~Store interface and SQLite schema~~ DROPPED 2026-11-18: no server storage (D-C8) | eng | dropped |
| O-C4 | Cohort in `StateContext` and the fingerprint (list hash; `coverage_mode: common` for cross-round cards) | eng | BUILT (Tasks 1 to 4) |
| O-C5 | PC cohorts across AC-designed rounds need an AC-keyed membership snapshot supplied by the host layer (`matbodh_views/named_runtime.py` in MatBodh-Dash, plain analysis path; the selection path already does it). Small change, untried | engine host layer | open (blocks PC cohorts across rounds only) |
| O-C6 | Live check that relationship, ranking and grid cards run under a cohort filter | eng | live check not yet run (needs VPN and owner go-ahead); smoke flag built |
| O-C7 | Small "seats in this cohort" list (the investigation drawer is dropped) | eng | BUILT as the seat list in the preview; names need a read endpoint (open) |
| O-C8 | Identify the survey dataset table and column that lists scenarios per anchor round (source decided: D-C6); the builder finds it in the existing metadata session, no invented list | eng | BUILT: party scenarios from the anchor dataset via party_scenarios_of |
| O-C9 | Surface the predicate rules on the cards: rank_max is per partition and includes ties; a flip needs a reference endpoint (the flip table comes from seat benchmarking); demographic ranking cards offer no cohort action (rules confirmed, D-C7) | eng | BUILT: flip needs a reference, demographic cards have no action; rank_max per partition shown by the engine |
| O-C10 | Cohort preview shows count and ids only; no overall vote-share table in the preview (spec 5.3 wanted it; decided in Task 5 ruling) | eng | open (optional) |
| O-C11 | Seat names in the cohort preview and tab (needs a read endpoint on the master label lookup) | eng | open |
| O-C12 | Engine `validate_selection` only runs live (completed-seat metadata); the offline loader test covers `selection_view_from_dict`. Verify live | eng | open |
| O-C13 | The cohort tab has no nav item; reachable through Use as cohort or `/cohort` | owner (UI) | open |

### 2.2 Relationship cards

| ID | Item | Owner | Status |
|---|---|---|---|
| O-R1 | Flow-summary Details lacks the impact fields and masses that spec section 7 lists | eng | open |
| O-R7 | A run whose compile turns unavailable after planning shows `assembly: KeyError`; fail with the plan's reasons (benchmark has the same pattern) | eng | open |
| O-R8 | Second alliance lookup in `start()` is unguarded and may differ from the compile's majors; have compile return the majors it used (benchmark same) | eng | open |
| O-R9 | Duplicate `include_recalled` statuses pass load validation and fail at run time | eng | open |
| O-R10 | `rules.order` and `rules.label` are not applied to group values or parties (only natural ordering is) | eng | open |
| O-R11 | Low-base handling for tiny groups: raw N under Details only, no flag | owner (threshold, see Q-2) | open |
| O-R12 | Not verified: PC level, cohort-filtered runs, scenario-donor weights (`weights.external` deferred) | eng | open |

### 2.3 Ranking cards

| ID | Item | Owner | Status |
|---|---|---|---|
| O-K1 | A demographic group dropped by the engine for zero base is labelled `outside_top_k` | eng | open |
| O-K6 | In compare mode the subtitle can name the compare round as the anchor | eng | open |
| O-K8 | No test runs the compiled ranking through the engine loader (`ranking_from_dict` + offline resolve); benchmark has one | eng | open |
| O-K9 | The ranking translator applies no presentation rules (gender Other would show on a gender-level demographic ranking) | eng | open |
| O-K10 | Spec section 6 RuleSet names/ordering not applied to partition headers | eng | open |
| O-K11 | Demographic-ranking compare mode never verified live | eng | open |

### 2.4 Benchmark cards

| ID | Item | Owner | Status |
|---|---|---|---|
| O-B1 | Footer lacks roster and mapping versions; coverage missing from the method drawer (spec section 8) | eng | open |
| O-B2 | No Playwright journey for the benchmark card; never viewed in a browser against a live API | eng | open |
| O-B3 | PC-level benchmark unverified live | eng | open |
| O-B4 | `config/elections.yaml` is UP only; owner must supply other states and elections | owner | open |
| O-B5 | Sort / Density / Details chips not built (Sort must store a round/endpoint name and clear on table/reference change) | eng | open |
| O-B6 | Seat-level Other items (spec section 12.1): per-seat listed shares do not reach 100%, a non-major winner shows a raw party id, `won` flags cannot count Other wins, focal margin is against the strongest eligible competitor and `seat_results` has no runner-up field | engine + eng | open |
| O-B7 | Master-down stall: the 60 s seat-label failure cache can hold the service lock up to the 10 s MySQL connect timeout once per minute | eng | open |
| O-B8 | Engine DB tests `tests/test_party_grouping.py`: 8 of 13 skipped; numerical coverage came from live runs only | engine | open |

### 2.5 Grid cards and foundation

| ID | Item | Owner | Status |
|---|---|---|---|
| O-G1 | Details popover does not show `relative_change_pct`, `reference_value`, base | eng | open |
| O-G2 | `payloadToGrid` runs twice per render | eng | open |
| O-G3 | Fixture leftovers (plan_scoreboard, unused FLAG_INFO, both_trend preset, seats unit, deltaTitle) | eng | open |
| O-G4 | Spec 6.2 engine resolve in the plan and spec 5 caste-needs-category unimplemented; fixtures lack a `missing_or_zero_gender_base` row and a `missing_target` compare cell | eng | open |
| O-G5 | Live checks never run for grid compare/trend, single-dimension non-numeric cut ordering, `common` coverage with differing seat sets | eng | open |
| O-G6 | Intra-round delta label shows the raw scenario id ("Δ vs ls_past"); needs owner-provided display names (do not invent) | owner | open |

### 2.6 Platform, process and housekeeping

| ID | Item | Owner | Status |
|---|---|---|---|
| O-P1 | Phase 1b minors: registry-driven default formatting (heat on delta for zones), "Δ on N common seats" footnote, >4-round sparkline note, seats AC·PC one cell vs two columns, gender-gap F/M string from backend, fieldwork period in round hover, CSV notes + BOM, state-level coverage note wording, T1/T3/T4/T7/T9 | eng + owner | open |
| O-P2 | Per-state "universal overview" card (rounds as rows, scenarios as columns): unassigned idea. Figma frames B, D, E still use the older style | owner | open |
| O-P3 | Alliance specificity precedence and per-round mapping (engine requires exactly one context match today) | engine + owner | open |
| O-P4 | Smoke script prints a raw traceback (with the DB host) on connection failure | eng | open |
| O-P5 | Bundle size warning (chunks over 500 kB) from the Vite build | eng | open |
| O-P6 | Stale claude-mem work list `analytics-card-brainstorm`; the session files are the source of truth | eng | open |
| O-P7 | Owner's uncommitted edit `docs/specs/2026-11-08-dashboard-design.md`: never touch or commit it. Untracked: `.codegraph/`, `CLAUDE.md`, `prototypes/`, `uv.lock` | owner | standing |
| O-P8 | Engine repo has uncommitted `compiler.py` / `validation.py` changes (`binding_observation` validation scope) with no test seen | engine | open |
| O-P9 | `npm run e2e` has no journey for benchmark or relationship cards | eng | open |

## 3. Questions for the product owner

| ID | Question | Blocks |
|---|---|---|
| Q-1 | Undecided/NOTA rows and competition exclusion (preset `competition_excluded` is only `["NOTA"]`) | scoreboard rows, seat competition |
| Q-2 | Low-base threshold | O-R11 and every small-group cell |
| Q-3 | Uncertainty / margin-of-error method | any uncertainty display |
| Q-4 | Cache expiry | runner cache policy |
| Q-5 | Seat-map GeoJSON source | seat maps |
| Q-6 | Zone / vibhag / district levels | geographic levels |
| Q-7 | Elections list for states other than UP | O-B4 |
| Q-8 | Method preset final values (provisional UP values in design spec section 20) | method drawer, defaults |
| Q-9 | Sentence-builder depth and who may edit presets | sub-project 6 |
| Q-10 | ~~Under a cohort, rank only the cohort's seats or rank all and show the cohort?~~ DECIDED 2026-11-18 (owner): Option A, rank/compare only the cohort's seats (engine `seat_ids`); see D-C9 | closed |

## 4. Decisions log

Newest first inside each group. A decision changes only when the owner says so.

### Cohorts (5b)
- D-C1 (2026-11-12, owner): a cohort is a saved named list of AC or PC ids with provenance (source, predicate, engine version, metadata revision, alliance epoch). Applying it is an `ac_num IN [...]` / `pc_num IN [...]` filter on every card through the dashboard context; existing cards do not change; the investigation drawer is dropped. Live-verified equivalence: selection "NDA winning in R2" = 154 AC, the same cut with the id list gave identical numbers.
- D-C3 (2026-11-18, owner): Approach 1 confirmed: the cohort is part of the dashboard context (`StateContext.cohort`); the compiler adds `ac_num/pc_num IN [list]` to every engine job and switches cross-round cards to common coverage; PC cohorts across AC rounds need the host membership snapshot (O-C5).
- D-C9 (2026-11-18, owner): under a cohort, seat rankings and benchmarks rank and compare ONLY the cohort's seats (engine `seat_ids`); a statewide rank for cohort seats is not built. Q-10 closed.
- D-C8 (2026-11-18, owner): a cohort is SESSION-ONLY. The seat list is reused only within the user's session because the same query can return a different list after survey data updates. No persistent storage, no save/list/rename/delete API, no SQLite or Postgres store. The list lives in the browser session (sessionStorage, per state, never in the URL) and travels inside `StateContext.cohort` with each request; the backend validates it (1 to 2000 positive integer ids, deduplicated). The only new route is `POST /cohorts/preview`. This SUPERSEDES the persistence parts of D-C1, D-C2, D-C4 and D-C7 (naming, immutability-by-record, store, URL id, save step, provenance fields). The plan and spec were revised the same day.
- D-C7 (2026-11-18, owner): making a cohort re-triggers the card's own seat ranking or seat benchmark request with the selection predicate, then the fixed overall vote-share query; raw contract and result data of the ranking or benchmark are NOT stored. Only the seat list, a minimal re-runnable `source` and provenance are stored. This supersedes the "stored rows are selection_rows plus the contract" part of D-C2. Demographic ranking cards have no cohort action; flip tables come from seat benchmarking.
- D-C6 (2026-11-18, owner): "all available party scenarios" for the creation query come from the survey dataset tables for the anchor round.
- D-C5 (2026-11-18, owner): creation starts from the seat ranking and benchmark cards themselves (no separate dialog). Ranking cards: `rank_max` (and metric bounds) on any seat ranking card; benchmark cards: margin range, status, flip class and endpoint. The card's own config is the selection source. The creation query is fixed: overall vote share in the anchor round for all available party scenarios. The cohort then opens a new blank canvas holding just that overall vote-share table; every further card on it is filtered by the cohort's AC/PC list. UI/UX is the owner's and not part of this design.
- D-C4 (2026-11-18, author calls in `docs/specs/2026-11-18-seat-cohorts-design.md`, PENDING owner review; the dialog and v2-shortcut parts are SUPERSEDED by D-C5): cohort is immutable, rename and delete allowed, name unique per state; URL carries only the cohort id; no fingerprint change needed because the filter is in the compiled config (to be proven by test); preview before save; empty selection never saved; PC cohorts limited to single-round cards until the membership prerequisite is built; method drawer shows the cohort's creation-time metadata revision.
- D-C2 (2026-11-12): creation runs an engine `EntitySelection` with a clean `selection.source_request` and a minimal fixed downstream cut; the stored rows are `selection_rows` plus the contract. Store is SQLite behind a narrow interface now, Postgres at the access-control phase.

### Cards and display
- D-1: the engine owns every number; Python and TypeScript only reshape. A missing value is a dash with a reason, never 0.
- D-2: the card `view` is never fingerprinted, so copy cards share one run; engine `benchmark.id` is the constant "benchmark" and relationship job id is "relationship".
- D-3: gender "Other" is hidden universally (`config/presentation/global.yaml`). Focal party and scenario lists come from alliance mapping and survey datasets, not presets.
- D-4: round labels are series-qualified (never bare R1). Percentages show whole numbers at |v| ≥ 2 and two decimals below.
- D-5 (2026-11-18): a null dimension value is `~null` in payloads and displays as "(no value)" (grid and relationship). Relationship groups sort with digit runs as numbers.
- D-6 (2026-11-18): Search chip exists only where it filters something (relationship summary yes, matrix no). Relationship CSV is the table on screen including Details columns.

### Alliance, parties and benchmark
- D-7: major parties come from the alliance table only; everything else including NOTA is one engine-built Other row. A party missing from one endpoint is a dash with a reason. The focal party must be mapped for every endpoint and is validated at compile time.
- D-8: election endpoints use `passthrough: true`. Relationship runs never pass explicit party `options` (they crash the SQL).
- D-9: default alliance policy: same canonical labels everywhere, default mapping per state unless a survey-specific mapping was ingested (needs engine work, see O-P3).

### Rankings and runner
- D-10: sub-project 2 folded into 3. Rank pipes use one engine job per round; the anchor round decides rows. Demographic ranking requires `top_k` 1-5. Party id is `NDA`. Compare uses common coverage like the grid. Gender differential has no compare.

### Process
- D-11: live runs need VPN and the owner's go-ahead each time and are read-only. Never print or commit credentials. Nothing destructive on production masters.
- D-12 (2026-11-18): this repo's origin is `https://github.com/Yash1289/matbodh_dashboard_fe.git`; `main` is pushed; merged feature branches are deleted.
- D-13: access control (state + configuration level) is the last phase.

## 5. Closed

| ID | What | Closed |
|---|---|---|
| O-R3 | Relationship CSV omitted Details columns | 2026-11-18 |
| O-R4 | Search chip did nothing in the Matrix (hidden there) | 2026-11-18 |
| O-R5 | Null dimension value became "None" | 2026-11-18 |
| O-R6 | Relationship groups sorted by key text (`g10` before `g2`) | 2026-11-18 |
| O-G7 | Stale `ranked_demographic_standalone` fixture regenerated | 2026-11-18 |
| O-H1 | Git remote added and `main` pushed; merged branches deleted | 2026-11-18 |
| O-H2 | ClickHouse dictionary `warehouse.ac_population_factor_dict_v2` was misconfigured (infra); fixed, live smoke of five cards passed | 2026-11-18 |
| (2026-11-12) | Benchmark polish, ranking polish, stale-sort fix | 2026-11-12 |
