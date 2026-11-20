# Open items and decisions ledger

The single living list of small pending items and small decisions for the dashboard. Update it in the same change that opens, closes or decides something; never delete a row, move it to "Closed" with the date and commit. Larger designs live in `docs/specs/` and `docs/plans/`; this file only points to them.

IDs are stable: `O-` open item, `Q-` question for the product owner, `D-` decision. Owners: **owner** = product owner decides; **eng** = engineering can just do it; **engine** = needs a MatBodh-Dash change; **infra** = environment or DevOps.

Last reviewed: 2026-11-19.

## 1. Roadmap

| # | Sub-project | Status |
|---|---|---|
| 1a / 1b | Backend + frontend platform | Done |
| 1 | Card foundation + grid cards (distribution, opinion, gender differential) | Done |
| 2 | Runner fan-out | Folded into 3 |
| 3 | Seat and demographic ranking | Done, live-verified |
| 4 | Benchmark (`seat_benchmark`) | Done, live-verified (UP) |
| 5a | Relationship cards | Done, live-verified |
| 5b | Seat cohorts (session-only) | Done: merged to main and pushed 2026-11-18, live-verified |
| 6a | Card configure: per-family configure panel, option lists, validate, inline cards, copy card/config | Built 2026-11-19 on `feat/card-configure` (spec `docs/specs/2026-11-19-card-configure-design.md`, plan `docs/plans/2026-11-19-card-configure.md`); not live-checked |
| 6b | Canvas and tabs: place and resize cards, tabs like sheets | Built 2026-11-20 on `feat/canvas-and-tabs` (spec `docs/specs/2026-11-20-canvas-and-tabs-design.md`, plan `docs/plans/2026-11-20-canvas-and-tabs.md`); deviations in section 2.1c |
| 6c | Context step (anchor, comparison, pipe rounds for all tabs) and saving (browser now, database with access control) | Context step built 2026-11-20 (first screen before the canvas; the bar edits it later). Per-card round override and saving: not started, see O-C1 |
| last | Access control (Postgres, state + configuration permissions) | Not started |

## 2. Open items

### 2.1 Cohorts (5b)

| ID | Item | Owner | Status |
|---|---|---|---|
| O-C1 | Where cohort creation starts: DECIDED 2026-11-18, from the seat ranking and benchmark cards themselves (D-C5) | owner | BUILT 2026-11-18 (Tasks 5, 6, 8) |
| O-C2 | ~~Cohort naming, provenance and edit rules~~ DROPPED 2026-11-18: cohorts are session-only, no names, no edit (D-C8) | owner | dropped |
| O-C3 | ~~Store interface and SQLite schema~~ DROPPED 2026-11-18: no server storage (D-C8) | eng | dropped |
| O-C4 | Cohort in `StateContext` and the fingerprint (list hash; `coverage_mode: common` for cross-round cards) | eng | BUILT (Tasks 1 to 4) |
| O-C5 | PC cohorts across AC-designed rounds need an AC-keyed membership snapshot supplied by the host layer (`matbodh_views/named_runtime.py` in MatBodh-Dash, plain analysis path; the selection path already does it). Small change, untried | engine host layer | CLOSED 2026-11-18: built (engine 55d32d4 + dashboard runner loader) and LIVE-verified: PC cohort (5 PCs) over two AC rounds through relationship.up_past_to_current and up_mla_to_current, four-flow identity holds; no-cohort and AC-cohort runs unchanged |
| O-C6 | Live check that relationship, ranking and grid cards run under a cohort filter | eng | CLOSED 2026-11-18: live (UP, R1+R2, read-only): AC cohort, benchmark cohort (140 AC), PC cohort, relationship / distribution / ranking / benchmark under each all done |
| O-C7 | Small "seats in this cohort" list (the investigation drawer is dropped) | eng | BUILT as the seat list in the preview; names need a read endpoint (open) |
| O-C8 | Identify the survey dataset table and column that lists scenarios per anchor round (source decided: D-C6); the builder finds it in the existing metadata session, no invented list | eng | BUILT: party scenarios from the anchor dataset via party_scenarios_of |
| O-C9 | Surface the predicate rules on the cards: rank_max is per partition and includes ties; a flip needs a reference endpoint (the flip table comes from seat benchmarking); demographic ranking cards offer no cohort action (rules confirmed, D-C7) | eng | BUILT: flip needs a reference, demographic cards have no action; rank_max per partition shown by the engine |
| O-C10 | Cohort preview shows count and ids only; no overall vote-share table in the preview (spec 5.3 wanted it; decided in Task 5 ruling) | eng | open (optional) |
| O-C11 | Seat names in the cohort preview and tab (needs a read endpoint on the master label lookup) | eng | open |
| O-C12 | Engine `validate_selection` only runs live (completed-seat metadata); the offline loader test covers `selection_view_from_dict`. Verify live | eng | VERIFIED live: the engine accepted the selection run (validate_selection passed) for ranking and benchmark sources |
| O-C13 | The cohort tab has no nav item; reachable through Use as cohort or `/cohort` | owner (UI) | open |

### 2.1b Card visual design (build of 2026-11-20)

Spec: `docs/specs/2026-11-20-card-visual-design.md`. Built on branch `feat/card-visual-design`. The items below are what the build did not do or decided differently from the mock-ups.

| ID | What | Owner | Status |
|---|---|---|---|
| O-V1 | Friendly question names: the options endpoint returns the id as the label, so pickers show ids. A label source (backend) is needed | eng | open |
| O-V2 | Relationship Matrix keeps the engine's pair-per-row table with all measures; the mock-up's origin by destination grid (one measure, tinted) is not built. Decide whether the grid replaces the measures | owner | open |
| O-V3 | Configure pickers are native grouped selects and check-box lists (groups, recalled and seat marks, reasons, disabled options); the mock-up's popover list with search is not built | owner (UI) | open |
| O-V4 | The ranking, benchmark and relationship cards keep their own control rows (Order, Search and a menu); the shared View menu and chip system are on the grid card only | eng | open |
| O-V5 | Make cohort rows in the margin-bucket and flip tables (a shortcut per row); the card menu item is the only entry point | eng | open |
| O-V6 | Seat selector's All choice exists only when the card asked for the sibling cut (the remaining fields on their own); otherwise it defaults to the first seat value | owner | open |
| O-V7 | Dark mode; Configure at phone width; narrow cards checked in a browser only at one width | eng | open |
| O-V8 | The per-endpoint "Seat summary" benchmark table is replaced by the merged Summary; its seat-share and eligible columns are not shown (CSV export keeps them) | owner | open |
| O-V9 | Review minors: a ranked slot with a null rank shows a dash, not "Not ranked"; the row limit and folded groups survive a new run, and folded groups still use the 100-row budget | eng | open |
| O-V10 | Export CSV on a crossed seat cut exports only the chosen seat group, without saying so; the cut changes shape once field scopes arrive | eng | open |
| O-V11 | The seat list, lens tabs and table tabs announce listbox and tab roles without arrow-key navigation or tab panels; the narrow Cut chip, the table chooser and the seat selector never show the changed-from-default mark | eng | open |
| O-V12 | Tint rgb values in `formatRules.ts` duplicate the theme tokens and are outside the colour test; the last row of each table group loses its bottom rule; no test for a Summary group with no row for a party; `docs/testing.md` does not exist | eng | open |


### 2.1c Canvas and tabs (6b) - IDs O-W

| ID | Item | Owner | Status |
|---|---|---|---|
| O-W1 | Library cards (the shared set) no longer render in a list of their own: they appear only when added from Add card, as the analyst's own copy. `cards.yaml` is empty by default, so nothing visible is lost today | owner | decided in the spec; built |
| O-W2 | Drag is by a slim toolbar row above each card (handle and card menu), so none of the four card components changed. It costs about 26px of height per card | eng | built |
| O-W3 | Tabs are renamed from the tab menu only (no double-click); reordered from the menu (no dragging); a card moves between tabs with Move to tab in the card menu | eng | built |
| O-W4 | Fit to content measures the card's first child element, so a card whose root is taller than its content (for example one with a trailing loading row) may fit slightly loose | eng | open (check in a live run) |
| O-W5 | A failed library request (`GET /cards`) now shows an alert above the canvas instead of replacing the page, since the canvas no longer depends on the library | eng | built |
| O-W6 | The grid is laid out at the usual page width (1220px) until the first width measurement, so the first frame can differ from the final one on a narrow window | eng | open (minor) |
| O-W7 | Not run: a live check against the production engine. Manual steps: open Cards for a state, add two cards, drag, resize, reload; add a second tab and move a card to it | eng | open |
| O-W8 | Final-review minors, deferred: stored item `h` and `y` have no upper bound, so hand-edited data such as `h: 1e9` can freeze the next Add card | eng | open |
| O-W9 | Copy card is not always directly below the original (a neighbour with the same row and a smaller column can take the place); the "copied below" message also fires when the copy fails | eng | open |
| O-W10 | The active tab is stored, so two browser windows on the same state switch tabs together through the storage event | owner | open (follows from "the active tab is remembered") |
| O-W11 | In the one-column layout the menu still offers Move left/right, Size and Fit, which change nothing visible there but still announce a result | eng | open |
| O-W12 | A repeated screen-reader message (the same text twice in a row) is not announced again; the tab list holds the tab menu buttons, which screen readers may not expect in a tablist | eng | open |
| O-W13 | Unverified: Escape while renaming a tab may still save the draft if the browser fires blur when the input is removed. Add a browser check | eng | open |
| O-W14 | Foreign stored data: duplicate tab ids and empty tab names survive reading; a card whose family list failed to load, or whose family is unknown, shows as an empty cell with no message | eng | open |
| O-W15 | The `CardsPage` doc comment still mentions library cards that no longer render on their own | eng | open |
| O-W16 | `cardStore.load` returns a new empty list on every call when storage throws and nothing is in memory; with blocked storage this may re-render in a loop (outside the 6b diff, found by the review) | eng | open |

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
| O-P7 | Owner's uncommitted edit `docs/specs/2026-11-08-dashboard-design.md`: never touch or commit it. Untracked: `.codegraph/`, `CLAUDE.md`, `uv.lock` (`prototypes/` deleted 2026-11-19) | owner | standing |
| O-P8 | Engine repo has uncommitted `compiler.py` / `validation.py` changes (`binding_observation` validation scope) with no test seen | engine | open |
| O-P9 | `npm run e2e` has no journey for benchmark or relationship cards | eng | open |

### 2.1b Configure (6a) - IDs O-F

| ID | Item | Owner | Status |
|---|---|---|---|
| O-F1 | Seat segmentation (seat type/score from a past election; NDA/BJP+ view only; seat ranking and benchmark; data in MySQL `acDashboard_retrosegement`) deferred. Proposed shape: seat type as a seat attribute plus a "Seat type from" election picker, `segmentation_party` in the preset | owner | deferred 2026-11-19 |
| O-F2 | Derived categories (engine `conditional_variables`) as a rule-editor widget; the descriptor model leaves room (`slot` widget, one more condition use) | owner | deferred 2026-11-19 |
| O-F3 | Benchmark seat filters (`benchmark.filters`) are not offered in configure; the compiler sends none | owner | deferred 2026-11-19 |
| O-F4 | The "showing 2 of the 3 rounds asked for" note is shown in the configure summary and the plan response, not yet in the card footer | eng | open (with the 6b card redesign) |
| O-F5 | Live check of one card per family configured end to end, plus hide parties, contenders, config reference, joint weight scenario and the filter-values run | eng | VERIFIED live 2026-11-19 (UP, R1+R2, read-only, owner go-ahead): 31/31 checks. Option lists from the live catalogue and alliance table (7 party scenarios, Q-11 excluded, 28 cut fields, no seat type, 14 seat attributes, elections 2009-2024, contenders incl. INDI for 2022 VS); every family validated and ran from an inline config (distribution with hide parties, trend with pipe_rounds 3 -> note, opinion compare, gender gap, seat and demographic ranking, benchmark vs 2022 VS with contenders NDA+SP+, relationship with scenario joint weight); caste filter values from an engine run (66) and a filtered card ran; repeat run was a cache hit. Benchmark with contenders NDA+SP+: all 32 groups' vote shares sum to 100 and seats won = eligible seats (BSP counted in Other) |
| O-F6 | Cards a user configures live only in this browser (localStorage per state). The workspace (tabs and card positions, `mb.workspace.<state>`, which references cards by id) is stored the same way; both move to the database in 6c / the access-control phase | owner | open |
| O-F7 | A card shared with everyone is added by pasting "Copy config" output under `cards:` in `config/cards/cards.yaml` (which ships empty); no publish action | owner | decided |
| O-F8 | Scenario display names (the pickers show scenario ids) still need the owner's names (O-G6) | owner | open |

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
| Q-9 | ~~Sentence-builder depth~~ ANSWERED 2026-11-19: Configure is a backend-described form per family (D-K1), not a sentence builder. STILL OPEN: who may edit method presets (access-control phase) | access control |
| Q-11 | Include party scenarios without embedded weights (cm_choice_party, pm_choice_party, govt_change, *_swap_voting_intention) in the cohort creation query and overall vote-share card? Needs an approved external weight binding (for example base weights) | cohort overall table |
| Q-10 | ~~Under a cohort, rank only the cohort's seats or rank all and show the cohort?~~ DECIDED 2026-11-18 (owner): Option A, rank/compare only the cohort's seats (engine `seat_ids`); see D-C9 | closed |

## 4. Decisions log

Newest first inside each group. A decision changes only when the owner says so.

### Cohorts (5b)
- D-C1 (2026-11-12, owner): a cohort is a saved named list of AC or PC ids with provenance (source, predicate, engine version, metadata revision, alliance epoch). Applying it is an `ac_num IN [...]` / `pc_num IN [...]` filter on every card through the dashboard context; existing cards do not change; the investigation drawer is dropped. Live-verified equivalence: selection "NDA winning in R2" = 154 AC, the same cut with the id list gave identical numbers.
- D-C3 (2026-11-18, owner): Approach 1 confirmed: the cohort is part of the dashboard context (`StateContext.cohort`); the compiler adds `ac_num/pc_num IN [list]` to every engine job and switches cross-round cards to common coverage; PC cohorts across AC rounds need the host membership snapshot (O-C5).
- D-C10 (2026-11-18, found live, eng): the creation and cohort-tab queries use only party scenarios the engine accepts without a weight binding: embedded weight keys (vs_/ls_/mla_/mp_ voting intention and choice scenarios) plus recalled votes (vs_past, ls_past). Scenarios with no embedded weights (cm_choice_party, pm_choice_party, state/central_govt_change_party, *_swap_voting_intention) need an owner-approved external weight binding (engine: 'Explicit external weight binding required'), so they are left out. OWNER QUESTION Q-11: should those scenarios be included with an approved binding (for example base weights)?
- D-C9 (2026-11-18, owner): under a cohort, seat rankings and benchmarks rank and compare ONLY the cohort's seats (engine `seat_ids`); a statewide rank for cohort seats is not built. Q-10 closed.
- D-C8 (2026-11-18, owner): a cohort is SESSION-ONLY. The seat list is reused only within the user's session because the same query can return a different list after survey data updates. No persistent storage, no save/list/rename/delete API, no SQLite or Postgres store. The list lives in the browser session (sessionStorage, per state, never in the URL) and travels inside `StateContext.cohort` with each request; the backend validates it (1 to 2000 positive integer ids, deduplicated). The only new route is `POST /cohorts/preview`. This SUPERSEDES the persistence parts of D-C1, D-C2, D-C4 and D-C7 (naming, immutability-by-record, store, URL id, save step, provenance fields). The plan and spec were revised the same day.
- D-C7 (2026-11-18, owner): making a cohort re-triggers the card's own seat ranking or seat benchmark request with the selection predicate, then the fixed overall vote-share query; raw contract and result data of the ranking or benchmark are NOT stored. Only the seat list, a minimal re-runnable `source` and provenance are stored. This supersedes the "stored rows are selection_rows plus the contract" part of D-C2. Demographic ranking cards have no cohort action; flip tables come from seat benchmarking.
- D-C6 (2026-11-18, owner): "all available party scenarios" for the creation query come from the survey dataset tables for the anchor round.
- D-C5 (2026-11-18, owner): creation starts from the seat ranking and benchmark cards themselves (no separate dialog). Ranking cards: `rank_max` (and metric bounds) on any seat ranking card; benchmark cards: margin range, status, flip class and endpoint. The card's own config is the selection source. The creation query is fixed: overall vote share in the anchor round for all available party scenarios. The cohort then opens a new blank canvas holding just that overall vote-share table; every further card on it is filtered by the cohort's AC/PC list. UI/UX is the owner's and not part of this design.
- D-C4 (2026-11-18, author calls in `docs/specs/2026-11-18-seat-cohorts-design.md`, PENDING owner review; the dialog and v2-shortcut parts are SUPERSEDED by D-C5): cohort is immutable, rename and delete allowed, name unique per state; URL carries only the cohort id; no fingerprint change needed because the filter is in the compiled config (to be proven by test); preview before save; empty selection never saved; PC cohorts limited to single-round cards until the membership prerequisite is built; method drawer shows the cohort's creation-time metadata revision.
- D-C2 (2026-11-12): creation runs an engine `EntitySelection` with a clean `selection.source_request` and a minimal fixed downstream cut; the stored rows are `selection_rows` plus the contract. Store is SQLite behind a narrow interface now, Postgres at the access-control phase.

### Configure (6a)
- D-K1 (2026-11-19, owner): configure is a backend-described form per family (descriptor + generic renderer + `POST /cards/validate`); the frontend holds no card rules. A new card type is mostly data (one descriptor); a new input kind is one widget.
- D-K2 (2026-11-19, owner): relationship joint weights may come from a scenario (`relationship.joint_weight`), REPLACING the 5a decision "base joint weight only". The scenario must have embedded weights and exist in every round the card reads; the weight mode is the preset's.
- D-K3 (2026-11-19, owner): context (anchor, comparison, pipe rounds) is global for all tabs; a card may read fewer pipe rounds, stored as a COUNT ("the last N up to the anchor"), so it follows the context. Anchor and comparison rounds always follow the context. A per-card full context override is later.
- D-K4 (2026-11-19, owner): `config/cards/cards.yaml` ships empty; picking a library card gives the analyst a COPY (no live link); the shared set grows by pasting copied config.
- D-K5 (2026-11-19, review fix, eng): the ranking operation id is the constant "ranking" (it was the card id), so client card ids never reach the fingerprint and analysts' identical cards share a cached run. Tested for every family and for cohort previews.
- D-K6 (2026-11-19, eng): filter values come from an ordinary engine distribution job cut by the field (reporting-mapped, FINAL/final_valid/readiness applied, cached by fingerprint), not from new SQL or an engine helper. Plan amendment to spec 7.3.
- D-K7 (2026-11-19, eng): the benchmark reference lives in the card config (`benchmark.reference`); the on-card reference picker is removed and requests send no reference.
- D-K8 (2026-11-19, eng): hide-party options are the party rows a grid card has (`preset.keep` plus Other), not the alliance majors; inline cards are bounded (12 scenarios, 8 cuts, 8 filters, 200 values per filter, 200-character title).

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
| O-F9 | Dead frontend removed: `CardFilterBar` (superseded universal-card design), `InvestigationDrawer` (dropped with cohorts), `useElections` and `ElectionOption` (the benchmark reference picker moved into Configure), and the placeholder pages and nav links of the dropped State Pulse sections (Seat Battleground, Voter Coalitions, Leadership, Vote Movement) plus "My cards" and "+ Add a cut" (replaced by Configure's Add card). Old paths now go to the cards page. Navigation is redesigned with the canvas (6b) | 2026-11-19 |
| O-R3 | Relationship CSV omitted Details columns | 2026-11-18 |
| O-R4 | Search chip did nothing in the Matrix (hidden there) | 2026-11-18 |
| O-R5 | Null dimension value became "None" | 2026-11-18 |
| O-R6 | Relationship groups sorted by key text (`g10` before `g2`) | 2026-11-18 |
| O-G7 | Stale `ranked_demographic_standalone` fixture regenerated | 2026-11-18 |
| O-H1 | Git remote added and `main` pushed; merged branches deleted | 2026-11-18 |
| O-H2 | ClickHouse dictionary `warehouse.ac_population_factor_dict_v2` was misconfigured (infra); fixed, live smoke of five cards passed | 2026-11-18 |
| (2026-11-12) | Benchmark polish, ranking polish, stale-sort fix | 2026-11-12 |

### 2.1d Context step (6c, first part) - IDs O-C

| ID | Item | Owner | Status |
|---|---|---|---|
| O-C1 | Owner decision 2026-11-20: rounds (up to four, the pipe `R1\|R2`) are chosen once in the context and every card follows them; an individual card may override them. The override is not built: it needs a rounds field in Configure and the card's request to carry its own rounds instead of the context's | owner | open |
| O-C2 | The context step is the page shown while the URL has no context (`ContextStep`, same form as the bar's dialog, action Continue). Nothing else is gated on it; a bookmarked URL with a context skips it | built | closed |
| O-C3 | The app shell keeps the 220px sidebar at every width, so below about 700px the page is unusable. The step answers to its own width (container query), but the shell needs its own pass | owner | open |
| O-C4 | Critique 2026-11-20: grid and ranking cards now open 6 columns wide (two per row) and the canvas has Fit all heights. A new card still starts at its family's fixed row height until Fit is used; fitting on first render is not built. Cards placed by the unplaced-card rule (stored before this change) keep full width | owner | open |
| O-C5 | Owner decision 2026-11-20: the sidebar is tab management (list, add, rename, reorder, delete, open) and has no Cards link; Add card stays on the page, whose title is the active tab's name. Below 1100px the sidebar is a drawer. With no context there is no sidebar. The session cohort (one per session, not per tab) shows as a "Cohort" sub-tab under the active tab while it exists, and opens the cohort view | owner | open |
