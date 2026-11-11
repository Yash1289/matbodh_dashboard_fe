# Ranking Cards (Seat and Demographic) — Design Specification

| | |
|---|---|
| **Status** | Draft for review (brainstormed with the product owner, 2026-11-11) |
| **Project** | `matbodh-dashboard` |
| **Sub-project** | 3 of 6; absorbs the former sub-project 2 (runner fan-out), see §2.2 |
| **Builds on** | `2026-11-10-card-foundation-and-grid-family-design.md` (CardConfig, CardShell, ControlStrip, PipeCell, runner, cache) |
| **Plan** | `docs/plans/2026-11-11-ranking-cards.md` |
| **Engine contract source** | `MatBodh-Dash` 0.8.0: `docs/guides/seat-ranking.md`, `docs/guides/demographic-ranking.md`, `docs/usage.md` ("Seat ranking", "Demographic ranking"), `sample-output/result_rank*.json`, `sample-output/result_seat_rank_demograph.json` |

---

## 1. Intent

Add two card families that show engine rankings:

- **Seat ranking**: AC or PC seats ranked by a metric (party support, an opinion score, or a difference between two endpoints), optionally in partitions such as zone.
- **Demographic ranking**: groups of one profiling field (caste, age group, occupation, gender, any registered single-valued field) ranked inside a partition such as each AC, each zone or statewide.

Across rounds a ranking card shows pipes, for example `AC 1: 15 Rank R1 | 18 Rank R2`. The pipe is a frontend layout of separate per-round engine rankings. The engine owns every rank and number; Python and TypeScript never compute, re-rank, round or fill one.

## 2. Scope

### 2.1 In scope

- Families `seat_ranking` and `demographic_ranking`, in the same `CardConfig`/`cards.yaml` and the same modes as the foundation: `standalone`, `compare` (rank of a delta metric) and `trend` (rank pipes over 2–4 rounds). Modes never combine.
- Grains, in priority order: AC seats; PC seats (native PC surveys, and PCs derived from AC surveys); demographic levels.
- A kind-aware result merge in the runner: a trend card runs one engine job per round (this is the former sub-project 2).
- A `RankedPayload`, a ranked-table card body, and display controls for it.

### 2.2 Decomposition change

The foundation spec listed "runner fan-out" as sub-project 2. Analysis requests already take many observations plus a `reference_observation` (this handles caste clubbing and pipes for the foundation families), so those cards need no fan-out. A ranking or benchmark result holds exactly one operation with one target and an optional reference, so a rank pipe across rounds needs one job per round. The merge is therefore designed here, against real ranking samples, and sub-project 4 (benchmark) reuses it. Sub-project 2 no longer exists as a separate item.

### 2.3 Out of scope

- Ranking groups of seats by a seat attribute (for example ranking zones against each other). The engine has no such grain: zone-like attributes are only `partition_by` and seat-attribute `filters`. It would need an engine change.
- Change in rank between rounds (the engine states it does not implement it); a bottom-k list (the engine ranks "rank ≤ k" in the metric's own direction only); `ranking_segmentation` (contextual election axes); entity selection wrappers (sub-project 5); the Configure modal (sub-project 6).
- A per-round rank for an entity outside a demographic `top_k` (see §5.3).

## 3. Rules from the product owner

1. Rank pipes across rounds are a frontend layout of per-round engine values. The ranked entity must exist in the other rounds too; where it does not, the slot is a dash with a reason, never a zero.
2. **Demographic ranking requires `top_k`, from 1 to 5**, applied within each partition (each AC, PC, zone or other seat attribute; statewide when there is no partition). `CardConfig` rejects a missing value or a value above 5. The cap is one named constant.
3. **Seat ranking is unrestricted**: no cap, `top_k` is optional (a seat ranking of all 403 ACs is small).
4. In a multi-round pipe **the anchor round decides the rows and their order**: its ranked entities, ordered by its rank. The other rounds are looked up for those entities. The Sort chip can reorder by any round's rank in memory.
5. Gender differential has no compare (unchanged from the foundation). No ranking card has a "change in rank".

## 4. `CardConfig` additions

`family` gains `seat_ranking` and `demographic_ranking`. A card with either family carries a `rank` block in addition to the foundation fields:

```yaml
- id: ranking.ac_pm_net
  family: seat_ranking
  section: rankings
  title: AC ranking, PM net satisfaction
  scenarios: [pm_satisfaction]
  comparison: {mode: standalone}
  rank:
    metric: net_score          # support_share (party), net_score | positive_share | negative_share (opinion)
    party_id: null             # required for party metrics and Shakti, forbidden for opinion metrics
    level: ac                  # seat: ac | pc ; demographic: any registered single-valued field, e.g. caste
    partition_by: [party_zone] # [] = statewide
    filters: []                # seat ranking only: seat attributes, {field, operator, values}
    top_k: null                # seat: optional ; demographic: required 1..5
```

Validation (all at the boundary, reusing the foundation's scenario-kind and comparison-kind rules):

- seat family: `level` is `ac` or `pc`; demographic family: `level` is a profiling field, not in `partition_by`, and `top_k` is 1–5.
- Party metrics need `party_id`; opinion metrics must not have one. The metric's scenario kind must match the metric.
- `compare`: target and reference endpoints are required and differ; the metric is the difference (`comparison_id` in the engine request). Shakti follows the foundation's rule (party target, opinion reference).
- `trend`: exactly one scenario, 2–4 rounds, standalone metric per round.
- `caste_clubbing` is rejected for demographic ranking (the engine disables it for that operation) and is not a ranking field for seat ranking.
- Seat `filters` are seat attributes; respondent filters (`filters` at card level) are rejected for seat ranking and are allowed for demographic ranking (the engine applies them to the population).

## 5. Execution and merge

### 5.1 Jobs

| Mode | Jobs | Request |
|---|---|---|
| standalone | 1, key `rank` | one ranking operation, target = anchor round and the scenario |
| compare | 1, key `rank` | one request carrying both endpoints and the comparison; ranking uses `comparison_id`, so the engine computes the delta |
| trend | one per asked round, key `rank:<obs_id>` | each job holds one round and the same metric, partitions, filters and `top_k` |

`EngineJob.kind` stays `"analysis"`; the runtime already dispatches configs that carry a `ranking` operation (`NamedSurveyRuntime`). Each job is fingerprinted, cached, retried and counted by the existing runner machinery. A card with a non-anchor round that failed is `partial`; a failed anchor job fails the card, because the rows are undefined.

### 5.2 Merge

`_assemble` is kind-aware. For ranking families it hands the per-job results, keyed by observation, to the family's translator, which builds one `RankedPayload`. A single-job card passes its one result. The merge never overwrites: two jobs returning the same `(entity, round)` is an error.

### 5.3 Missing entities in later rounds

- **Seat ranking without `top_k`**: every round returns the full seat list, so a missing anchor seat in a later round means the engine did not rank it (suppressed, not in the roster). The slot is a dash with reason `not_ranked` and the engine's `metric_status`.
- **With `top_k` (seat or demographic)**: an anchor entity absent from a later round's top-k has reason `outside_top_k`. This is not missing data and not a failure; the rank there is unknown, not zero.
- **A later round whose job failed**: every anchor entity has reason `round_failed` for that round; the card is `partial` and Refresh re-runs only that round.
- **Ties** keep the engine's rows: top-k includes ties, so a partition can have more than `top_k` rows. The cap limits the requested k, not the row count.

### 5.4 Engine behaviour the card must surface

- Missing, non-finite or zero-base metrics suppress **all** ranks and the engine raises; the card shows the engine's message as the unavailable reason (a `config` error), never partial ranks.
- Mixed AC/PC collection comparisons are not implemented; a PC ranking from an AC survey needs every constituent AC completed in every participating round. These arrive as engine errors and are shown as unavailable reasons. The compile step does not duplicate the engine's coverage rules; it only blocks what the catalogue already proves impossible (for example a PC survey asked for AC ranks).
- Row volume: demographic jobs are bounded by `top_k ≤ 5` per partition; seat jobs by the seat count.

## 6. Payload

A `RankedPayload` is long format, like the foundation `GridPayload`, and reuses its `rounds`, `coverage`, `unavailable`, `not_asked` and method blocks.

- `family`, `mode`, `entity_kind` (`seat` | `demographic`), `level`, `partition_by`, `top_k`, `direction` (`DESC` | `ASC`, from the engine), `unit` (from the engine).
- `groups`: one per partition value (`{}` when statewide), each with `eligible_count` per round (seat only, from `eligible_seat_count`).
- `entities`: key and labels. Seat: `seat_id` and, when the engine supplies it, the partition values. Demographic: the named dimensions of each row.
- `ranks` (long): `entity`, `group`, `round`, `rank`, `value` (engine `metric_value`), `target_value`, `reference_value`, `target_base`, `reference_base`, `weighted_denominator`, `unweighted_base`, `status` (engine `metric_status`), and `flags`.
- `absent` (long): `entity`, `group`, `round`, `reason` (`outside_top_k` | `not_ranked` | `round_failed`), derived from absence in a round's result or from a failed round's job, never from arithmetic.
- `contracts`: the engine contract per job (ranking id, direction, tie policy, coverage, observations, master versions) for the method drawer.

Display names and ordering of labels come from the existing presentation rules (`registry.RuleSet`); the registry's natural ordering applies where no order is configured.

### 6.1 Seat labels (names from the master)

Engine seat rows carry only `seat_id`, never a name (verified live on a PC ranking, 2026-11-11). Names are labels, not numbers, so the backend looks them up as small metadata, in this order per seat:

1. a name the engine row itself carries (any of `seat_name`, `ac_name`, `pc_name`, `name`; none exists today), so a future engine that returns names is used with no dashboard change;
2. otherwise a `SeatLabelProvider` lookup: `labels(state, level, seat_ids) -> {seat_id: {name, zone, ...}}`.

The default provider reads the master through the engine's own `MySQLAccess.seat_snapshot` (attributes `ac_name`, `pc_name`, `zone`), read-only, cached per state, level and metadata revision, and dropped when the catalogue refreshes. The provider is injected at bootstrap, like the catalogue loader, so tests use a fake and the dashboard never owns a second master model. A seat with no lookup result shows its number with no name; it never fails the card. The name and zone enter the payload as entity `labels`, never as a number.

## 7. Frontend

- Family bodies `seat_ranking` and `demographic_ranking` in the existing body registry, rendered inside `CardShell` with the same `ControlStrip` (display-only, never fetches).
- A ranked table: one row per anchor entity, ordered by the anchor rank; partitions as group headers; rank and value cells as `PipeCell`s in trend mode (`15 | 18`, rank first); a tie marker when two rows share a rank; dash plus reason for absent slots and engine statuses; the engine's unit and direction in the header.
- Controls: Sort (by any round's rank or value, in memory), search entities, density, details (bases and `eligible_count`), export CSV. No lens: a ranking has one metric, fixed by the card.
- Accessibility and responsiveness follow the foundation (§9.4).

## 8. Sample fixtures

Copy aggregate-only fixtures into `tests/fixtures/engine_samples`: `result_rank.json`, `result_rank_complex.json`, `result_rank_comp.json`, `result_rank_filtd.json`, `result_seat_rank_demograph.json` (the row sets the field-coverage test maps). `result_rank_entity_ranking.json` belongs to sub-project 5. A field-coverage test maps every key of every ranking row and contract, like the foundation's.

## 9. Testing

- **Config tests**: §4 validation, including top-k bounds per family and rejected combinations.
- **Compile tests**: each mode produces the right job set; trend emits one job per asked round with identical policy; compare keeps one job; a PC card on a PC-designed survey and on an AC survey.
- **Translator and merge tests**: split a ranking sample result by round, merge, and assert the payload equals the single-result translation; ties; partitions; an entity missing in a later round with each absence reason; suppressed ranks surface the engine message; property test that every number in the payload exists in a source result.
- **Runner tests**: partial state when a non-anchor round fails and Refresh re-runs only that round; adding a round runs one new job; a failed anchor fails the card.
- **Frontend tests**: pipe order follows the anchor; Sort by a later round; absent slots; tie marker; no request on any display control.
- **Live check**: a smoke script for one seat ranking and one demographic ranking on a real state. It needs the VPN and the product owner's go-ahead, and is not run otherwise.
- Run `pytest` and the frontend suites; skipped tests are not passes.

## 10. Open questions and assumptions

1. **PC from AC surveys (resolved, 2026-11-11, live).** `MySQLAccess.execute_ranking` loads the AC roster as the membership when the ranking carries `membership_snapshot: "ac_pc"`, so the dashboard supplies only that name, not a snapshot. A read-only run through the engine CLI on Uttar Pradesh, `2027 VS CAPI R2` (an AC-designed survey), `seat_level: pc`, PM net satisfaction, returned 80 PCs ranked 1–80 (`unit` percentage points, `metric_status` available). Config name for the universe snapshot is host-assigned (`pc_roster`). Other states and rounds are not verified.
2. **Seat metadata in the payload (resolved, 2026-11-11, product owner).** Names come from the master through the label provider of §6.1, falling back to any name the engine row carries once the engine provides one. Which other attributes to show beside a seat is a display choice at plan time.
3. **Demographic compare (resolved, 2026-11-11, product owner).** Kept in the system, built to the engine contract. The engine allows it when the comparison collections match; the only sample is standalone, so it is verified by unit tests now and by a live run later.
4. **Card library for rankings (resolved, 2026-11-11, delegated to the engineer).** The starter set is in §12.
5. **Heavy engine limits.** A seat ranking across many partitions is still bounded by the 100,000-row result limit; a `too_heavy` error is shown with its classified message.

## 12. Starter cards

Four seeded cards, all standalone and Uttar Pradesh scenarios already in `cards.yaml`; each can be extended to a trend with 2–4 rounds. The party id is `NDA`: the preset's canonical alliance id (`keep: [NDA, SP+, BSP]`) and the one `docs/usage.md` documents for ranking (the engine samples use `BJP+`; the live check confirms which the engine accepts). It is not invented.

| Card id | Family | Rank | Partition | `top_k` |
|---|---|---|---|---|
| `ranking.ac_pm_net` | seat_ranking | AC seats by PM net satisfaction (`pm_satisfaction`, `net_score`) | none (statewide) | none |
| `ranking.ac_bjp_support_by_zone` | seat_ranking | AC seats by `NDA` support share (`vs_voting_intention`, `support_share`) | `party_zone` | none |
| `ranking.pc_pm_net` | seat_ranking | PC seats by PM net satisfaction, from AC surveys (verified live, §10.1) | none | none |
| `ranking.castes_by_ac_support` | demographic_ranking | castes by `NDA` support share within each AC | `ac_num` | 3 |

## 13. Acceptance criteria

- A seat ranking card for AC and for PC, and a demographic ranking card with `top_k` 1–5, render every row and contract key of the copied samples with no unmapped key.
- `CardConfig` rejects a demographic ranking with no `top_k` or one above 5, and accepts a seat ranking with none.
- In trend mode the pipe rows and order follow the anchor round; later rounds are looked up; an entity not found shows a dash with `outside_top_k` or `not_ranked`.
- A trend card runs one job per round; compare and standalone run one; a non-anchor failure gives a partial card and Refresh re-runs only the failed round.
- No rank, value, delta or total is computed in Python or TypeScript (property tests).
- A missing value renders `—` with the engine's reason, never `0`.
