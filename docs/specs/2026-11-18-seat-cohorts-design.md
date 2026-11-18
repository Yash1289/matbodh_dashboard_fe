# Seat cohorts (sub-project 5b) — design

Revised 2026-11-18 (owner): a cohort is session-only. The seat list is kept in the user's browser session and is never stored on the server; a list from an earlier survey-data state could differ from what the same query returns now.

Status: DRAFT for owner approval. Ledger: `docs/open-items.md` (O-C1…O-C7, D-C1, D-C2). Calls made by the author rather than the owner are marked **[call]**.

## 1. Intent

An analyst finds a set of seats worth studying, for example "seats NDA wins in R2" or "seats NDA loses by under 5 points", keeps it for the session as a **cohort**, and then reads the whole dashboard (grid, ranking, benchmark and relationship cards) for just those seats. The cohort tab is the normal dashboard opened with the cohort applied, so every existing card works on it unchanged.

## 2. Goals, non-goals, anti-goals

Goals
- Keep a seat set from an engine seat selection for the rest of the user's session and reuse it without re-running the selection.
- Apply a cohort to any card through the dashboard context, with results that equal the engine's own selection run (verified live: 154 AC for "NDA winning in R2"; identical numbers with `ac_num IN [154 ids]`).
- Never mix cohort results with full-state results in the cache.

Non-goals (v1)
- An investigation drawer; per-seat drill-down beyond a small "seats in this cohort" list.
- Persistent storage of cohorts, saved/named cohort lists, rename/delete, editing a list, set algebra (union/intersection), sharing between users or links, access control (last phase).
- Cohorts from demographic rankings (the engine cannot supply a seat set from them).
- A standalone "New cohort" dialog separate from the cards (creation starts from the cards, section 5.3).
- Cohorts from demographic rankings or from analysis cards (distribution, opinion, gender, relationship): the engine supplies seat sets only from seat rankings and benchmarks.

Anti-goals (a failure even if it works)
- Any number computed in Python or TypeScript; the engine owns every number.
- An empty selection silently meaning "all seats". An empty selection is never usable as a cohort.
- A stale list presented as current: a cohort never outlives the user's session, and always shows its label, seat count and when it was made.

## 3. Constraints (from the engine and the codebase)

- Seat sets come only from an engine `EntitySelection` over exactly one seat ranking or one benchmark; predicates for the two kinds cannot be mixed. A demographic ranking cannot supply seats.
- When the downstream cut has caste clubbing, comparisons or filters incompatible with the source, the engine needs a complete separate clean `selection.source_request`. The creation cut therefore has none of these: overall vote share, all available party scenarios, the anchor round.
- AC selections accept AC-designed downstream surveys only; PC selections accept AC and PC surveys, and an AC-designed survey needs the full AC-to-PC membership.
- `pc_num` filters across two AC-designed rounds fail today ("Complete AC-to-PC membership snapshot required"). The ranking, benchmark and selection paths load membership; the plain named-config path does not (ledger O-C5).
- Selection takes 20–50 s per run; a filter run with the seat list took about 6 s.
- `StateContext` forbids extra fields (`extra="forbid"`), so the new field is a deliberate schema change.
- Run results are cached by a fingerprint of the compiled job config plus metadata revision, engine version and alliance epoch (`compiler/fingerprint.py`).
- Live runs are read-only and need the owner's go-ahead each time.

## 4. Approaches considered

1. **Cohort is part of the dashboard context (chosen, owner-approved).** `StateContext` gains an optional `cohort`; the compiler adds the seat filter to every engine job. No card, family or payload changes; capability gating reuses the existing table. A filter on the seat list gives the same numbers as the selection run and is about four times faster.
2. Run selection plus the downstream cut on every card render. Always matches the engine's selection, but is slower, needs a new job path per family, and re-runs selection on every refresh.
3. A per-card cohort chip. Smaller per card, but the same list would be applied card by card, there is no cohort tab, and the cache key would be per card.

Chosen: 1.

## 5. Design

### 5.1 The cohort (session value)

A cohort is a plain value held in the browser session; the server stores nothing. Fields:

| Field | Meaning |
|---|---|
| `seat_level` | `ac` or `pc` |
| `seat_ids` | the list (sorted, deduplicated, 1 to 2000 positive integers) |
| `label` | short text for the context bar, e.g. "Top 5 AC, PM net satisfaction · R2" (built from the card title and predicate) **[call]** |
| `created_at` | time shown next to the label |

It is immutable for its lifetime; making another cohort replaces it. "Clear cohort" returns to the full state. It is kept in session storage so a page reload in the same tab keeps it, and it is not in the URL, so a shared link never carries a list **[call]**.

### 5.3 Creation

Owner flow (2026-11-18): creation starts from the seat ranking and benchmark cards themselves. The card already holds the seat source (the ranking or benchmark the user is looking at); the user adds only the selection predicate, then the dashboard runs one small engine selection.

- Entry point: a "Make cohort" action on every seat ranking card (AC, PC, with or without partitions, standalone or compare) and every benchmark card. Demographic ranking cards do not offer it.
- Predicate on a ranking card: `rank_max` (applies within each partition and includes ties), optionally `metric_min`/`metric_max` with inclusive/exclusive bounds. Example: top 5 seats.
- Predicate on a benchmark card: margin range (`margin_min`/`margin_max`, e.g. -13 to -3), status (winning/losing), flip class (gain, loss, winning_both, losing_both; needs a reference endpoint), and which endpoint (current/target or reference) the predicate reads. The focal party is the card's, already validated against the alliance mapping.
- The source is the card's own config (its anchor round, target, party, filters and partitions). Making a cohort re-triggers that same seat ranking or seat benchmark request with the selection predicate added; nothing is read back from the card's already displayed result, so no raw card data is kept. The user does not re-enter the source.
- The downstream query is fixed: overall vote share (no cuts) in the anchor round for every available party scenario. The scenario list comes from the survey dataset tables for the anchor round (owner decision 2026-11-18); a scenario not recorded there for that round is never added. Nothing else (no caste, comparison or filters), so the engine needs no separate `source_request` beyond the clean copy of the card's source.
- The backend runs it as a new runner job kind `selection` through the existing queue, retries and error classification. The result's `selection_rows` give the seat ids and the contract gives provenance.
- After the run the user sees the seat count and a short seat list (the overall vote-share table is not shown in the preview; it appears on the cohort tab), then chooses "Use as cohort" **[call: a separate confirm step]**. Zero rows: "no seats matched", nothing to use.
- Using it opens the cohort tab: a new blank canvas holding just an overall vote-share table. The same table is an ordinary overall vote-share card run under the cohort filter (cached like any card), so no creation result is kept. The user then adds any other cards, and every card on that canvas runs filtered by the cohort. UI layout and canvas behaviour are the owner's and out of scope here; this design only guarantees the context and the first table.

### 5.4 Applying a cohort

- `StateContext` gains `cohort: CohortRef | None` (seat level, seat ids, label, created_at); the browser sends it in the context body with every plan and run request. The backend validates it at the boundary (nonempty, positive integers, at most 2000, level `ac` or `pc`) and treats it as data; there is no lookup.
- The card compiler adds one filter to every engine job: `ac_num IN [seat_ids]` for an AC cohort, `pc_num IN [seat_ids]` for a PC cohort. It composes with the card's own filters (AND, as the engine does).
- Cards with more than one round (trend, compare, relationship, rank pipes) switch to the engine's `coverage_mode: common`, which the engine requires when a seat filter is present.
- The filter is part of the compiled job config, so the existing fingerprint already separates cohort runs from full-state runs and from other cohorts; no fingerprint code change is needed **[call; verify by test]**.
- Capability gating: an AC cohort is accepted on AC-designed surveys only; a PC cohort on PC-designed surveys, and on AC-designed surveys only for a single round until the PC membership prerequisite (5.6) is built. A card that cannot run under the cohort is shown as unavailable with the reason, never silently unfiltered.
- The cohort tab is the existing dashboard page with the cohort in context. The cohort name and seat count appear in the context bar and in every card's method drawer.

### 5.5 API

One new route: `POST /cohorts/preview` (card id, context, predicate, optional reference; runs the selection and returns a run id). `GET /runs/{id}` returns the preview payload (seat ids, count, level, overall vote-share table). `POST /cards/plan` and `POST /cards/run` accept the cohort inside the context. There is no save, list, get, rename or delete route and no store.

### 5.6 PC cohorts on AC-designed surveys (prerequisite)

Single-round PC cuts work today. Cross-round PC cuts need the dashboard's engine host to supply the AC-to-PC membership snapshot to the named-config path, as the ranking and benchmark paths already do. It is built as its own task before PC cohorts are enabled across rounds, and until then PC cohorts are limited to single-round cards **[call]**. (Engine docs: `usage.md` near line 652.)

### 5.7 The "seats in this cohort" list

A small read-only list (seat number, name from the master lookup, and nothing computed) in the cohort's context bar popover. It is not a drawer.

### 5.8 Errors and states

- Selection job failure: same error kinds as other jobs (config shown, infrastructure generic).
- A cohort whose list is invalid is a 422 with the reason; an applied cohort that no card can use shows each card as unavailable with its reason.
- Master or alliance lookup failure never silently changes a cohort.

## 6. Verification

- Unit: compiler adds the right filter and common coverage per card family; fingerprint differs between cohort, other cohort and none; capability gating produces reasons; list validation (empty, duplicates, non-integers, size cap); empty selection never usable.
- Equivalence: a filter run with the seat list matches the selection run's numbers (the live check of 2026-11-12 becomes an automated numerical test using recorded samples, plus a live check with the owner's go-ahead).
- Live (owner go-ahead): AC cohort "NDA winning in R2" on one card per family; PC cohort single-round; PC cohort cross-round after 5.6.
- Frontend: dialog flow, URL round-trip, unavailable-with-reason, reload keeps the cohort in the same tab, clear cohort, e2e journey for create-then-apply.

## 7. Left to the builder

File layout, table DDL details, the exact dialog layout (design with the Figma wireframe and `ui-ux-pro-max`), the preview-then-save job hand-off, naming of the new job kind's config class, and test fixture construction.

## 8. Open questions

See `docs/open-items.md`: O-C5 (PC membership in the host layer), O-C8 (builder: the exact survey dataset table and column that lists scenarios per round), Q-2 (low-base threshold for small cohorts).
