# Benchmark Cards — Design Specification

| | |
|---|---|
| **Status** | Draft for review (brainstormed with the product owner, 2026-11-12) |
| **Project** | `matbodh-dashboard` |
| **Sub-project** | 4 of 6 |
| **Builds on** | `2026-11-10-card-foundation-and-grid-family-design.md` and `2026-11-11-ranking-cards-design.md` (CardConfig, CardShell, ControlStrip, runner, per-job cache, the per-round job merge) |
| **Engine contract source** | `MatBodh-Dash`: `docs/guides/election-benchmarking.md`, `docs/usage.md`, `examples/benchmark.rounds.example.json`, `examples/benchmark.election.example.json`, `sample-output/result_benchmark_past_election.json` |

---

## 1. Intent

One card family, `seat_benchmark`, that compares a survey round against nothing, another survey round or an actual past election, seat by seat, grouped by seat attributes such as zone. The engine returns five tables in one run; the card lets the user choose which table to look at. The engine owns every number: vote shares, seat counts, margins, flips, winners and coverage. Python and TypeScript never recompute, round or fill one. A seat with no result is a dash with a reason, never a zero.

## 2. Scope

### 2.1 In scope

- Family `seat_benchmark` in the existing `CardConfig` / `cards.yaml`.
- Endpoints: target is always the context bar's anchor survey round. Reference is one of: none, the context's compare round, or an actual election (year and LS/VS type) chosen on the card.
- Four display tables from one engine run: **Comparison**, **Seat summary**, **Margin buckets**, **Flips**.
- A runner path for `EngineJob.kind == "benchmark"` (declared today, never built or run), a benchmark payload, a benchmark card body.
- AC level, and PC level when the host can load the full AC-to-PC membership.

### 2.2 Out of scope

- Election as the target, and election-vs-election (future, if wanted).
- Entity selection wrappers built on a benchmark (`result_entity_benchmark*.json`; sub-project 5).
- A per-seat table as a card view. `seat_results` and `coverage` are carried in the payload for the investigation drawer (sub-project 5) and the coverage note only.
- Segmentation (`segmentation_context`, `segmentation_party`) and `filters` (seat filters). Not asked for.
- The Configure modal (sub-project 6): starter cards are chosen by the engineer in `cards.yaml`.

## 3. Rules from the product owner

1. **One run, a table chooser.** The backend runs one benchmark per card. The chooser only changes the display and never re-runs the engine.
2. **A card copy may change only the view.** Copying a card and changing only its view (for example Comparison to Flips) must reuse the same cached engine result. This is a design constraint, not an engine change (§4).
3. **Both endpoint kinds from the start.** Survey rounds and actual elections. The election year and type are chosen on the card.
4. **Alliance mapping is reused.** Historical party identity comes from the existing alliance table (ACTUAL contexts, `party_report_1`); nothing is re-sorted by hand.
5. **Unmapped historical parties compete individually** under their own party id (`passthrough: true` on the election endpoint), as the engine guide requires. They are never merged into Others. Decision confirmed by the product owner on 2026-11-12 after the live check (§11).

## 4. `CardConfig`: engine part and view part

```yaml
- id: benchmark.up_zone_nda
  family: seat_benchmark
  section: benchmarks
  title: UP seats, NDA vs reference
  benchmark:                 # engine part: feeds the fingerprint
    contenders: [NDA, SP+, BSP]
    focal_party: NDA
    grouping_sets: [[], [party_zone]]
  view:                      # display part: never fingerprinted
    table: comparison        # comparison | summary | margin_buckets | flips
```

- Everything under `benchmark` (plus seat level from the context, target, reference) is the engine part. Changing any of it is a new engine job.
- `view` holds the opening table and display defaults (sort, density). It is not part of the engine config handed to the compiler, so the fingerprint cannot depend on it.
- Default opening table when `view.table` is omitted: `comparison` if a reference exists, otherwise `summary`.
- Validation: `contenders` non-empty; `focal_party` must be a canonical identity available in the preset (`preset.keep`) or the card is unavailable (a party absent from `keep` would read as 0); `view.table` must be one of the four.
- **Fingerprint tests (required).** Two configs differing only in `view` give identical job fingerprints; a config differing in `contenders`, `focal_party` or `grouping_sets` gives a different one. The queue already runs one job per fingerprint across cards and users, so no runner change is needed for sharing.

## 5. Endpoints and the reference picker

- **Target:** the context anchor round, scenario from the card config, via the engine's survey benchmark endpoint (`SurveyBenchmark`).
- **Reference:** `none`, `compare round` (the context's compare round, as a survey endpoint) or `election` (year, LS/VS).
- **Election list:** the ACTUAL contexts of the selected state in the alliance table, intersected with elections that have results in the election master. An election with no single state-level alliance context fails explicitly (the engine raises); it is not listed and never guessed.
- The reference picker is the only control that changes the engine config. It starts a new run and says so; sort, search, density and Details never fetch.

## 6. Compile and run

- A benchmark compile step builds the engine's `SeatBenchmark` through the host loaders (`seat_benchmark`, `election_benchmark`) with `contenders`, `focal_party`, `grouping_sets` and `competition_excluded` left at the engine default (`NOTA`).
- Election endpoint party policy: alliance mapping for the chosen year/type, with `passthrough: true` (§3 rule 5).
- PC level needs the full AC-to-PC membership; the host loader builds it. Missing membership makes the card unavailable with the engine's reason.
- The runner executes one job with `kind: "benchmark"`, cached per fingerprint like any job. The plan step reports unavailability before any run: focal party not in `keep`, election with no alliance context or no results, PC without membership.
- Expected duration is about 50 s for UP at AC level (§11), so the card shows a running state with progress text, not a spinner alone.

## 7. Payload

`BenchmarkPayload` carries the engine tables as typed rows:

| Table | Source | Rows (UP sample) |
|---|---|---|
| Comparison | `comparisons` | 48 |
| Seat summary | `summaries` (per endpoint) | 96 |
| Margin buckets | `margin_buckets` | 192 |
| Flips | `flips` | 64 |
| (drawer, not a card view) | `seat_results`, `coverage` | 2418, 806 |

plus the contract (endpoints and versions, roster version, units, focal party, coverage mode, competition exclusions). Display rounding is a frontend presentation concern only; values are never recomputed. `seat_results` size (2418 rows for 403 seats) is measured in the plan; if too large it is dropped from the card payload until sub-project 5 needs it.

Unlisted winners appear in `seat_results.winner` as raw party ids; a party-name lookup (party master) labels them. A failed lookup never fails the card.

## 8. Card body and controls

- **Table chooser** chip. Tables that cannot exist are hidden, not shown empty: Comparison and Flips need a reference; Margin buckets and Flips need a focal party.
- **Comparison table:** per group and party: target share, reference share, change (pp), target seats, reference seats, seat change. Group headers use natural order and presentation labels, not raw keys.
- **Seat summary:** per endpoint, group and party: seats won, seat share, vote share, eligible seats.
- **Margin buckets / Flips:** the engine bins (0 to <5, 5 to <10, 10+, ahead or behind; winning both, gain, loss, losing both) with the eligible-seat denominator.
- **Controls:** reference picker (starts a run), Sort, Search, Density, Details, the usual overflow menu (method drawer, CSV export, Refresh). CSV exports the table on screen.
- **Footer:** coverage mode, source and mapping versions, roster version, a note when displayed seat shares sum to less than 100% (an unlisted party won seats), and "Not asked in ..." where applicable.

## 9. Errors and states

- One job, so no partial card: a failed benchmark fails the card with the engine's client-safe message and Refresh. Raw infrastructure text is never shown.
- No results for a seat or group: a dash with the engine's reason.
- Election with no alliance context, no results, or an unmapped-identity error that survives `passthrough`: the card fails with the engine's reason.

## 10. Testing

Run `python -m unittest discover -s tests -v` / `pytest` and `npx vitest run`, `npm run typecheck`, `npm run build`, `npm run e2e`.

- **Real-sample numerical fixture:** `result_benchmark_past_election.json`. Assert exact values, for example NDA/BJP+ all seats 42.07 vs 44.77 vote share, −2.69 pp, 154 vs 243 seats, −89. A wrong implementation (averaged zone shares, deltas recomputed from rounded numbers, summed subtotals across grouping sets) fails these.
- **A fixture built to distinguish wrong readings:** a party with vote share and zero seats (a real zero, not missing); a seat in coverage but not common (a dash with a reason); an unlisted winner so displayed seat shares sum below 100%; a group with no eligible seats.
- **Backend:** compile for each reference kind (none, compare round, election) at AC and PC levels; plan-time unavailability reasons; fingerprint tests (§4); the runner executes, caches and shares a `kind: "benchmark"` job across two cards with different `view`.
- **Engine loader test (automated):** run the compiled spec through the engine's real loader and compile offline (as the ranking minor 8 hand check did), so a malformed spec fails in CI.
- **Frontend:** default table rule; hidden tables; display chips never fetch; the reference picker starts exactly one run; a copied card with a different `view` renders from the same payload.
- **Not proof:** parsing or a Python evaluator is not treated as proof of the generated SQL; the live check below is the SQL evidence.

## 11. Live evidence (2026-11-12, UP, read-only, product-owner approved)

Run through the engine's own CLI with the example configs, not through the dashboard (no dashboard benchmark path exists yet):

- **Survey R2 vs R1, 47 s.** All five tables returned with the sample's row counts. Seat counts equal the sample (154 vs 243, 249 vs 158). Vote shares differ from the sample by about 0.01 to 0.02 pp (42.066 against 42.074 for the NDA/BJP+ row); the sample used the label BJP+, the live run NDA. The cause is not confirmed.
- **Survey R2 vs 2022 VS, with `passthrough: false` (the example's setting): fails** in the engine with "Unmapped historical party IDs" (about 300 raw party ids). The ACTUAL alliance mapping covers alliance members only.
- **Same run with `passthrough: true`, 53 s: completes.** 403 of 403 seats covered; NDA 273, SP+ 125, BSP 1 seats in the 2022 reference; flips sum to 403 (22 gain, 108 losing both, 141 loss, 132 winning both). The 2022 totals were not checked against an external source.

## 12. Not verified

- The dashboard benchmark path (compile, runner, payload, UI): not built.
- The election picker's source list and its intersection with election results.
- PC-level benchmark live; states other than UP; other election years/types.
- Production ClickHouse performance beyond the two runs above; `EXPLAIN`.
- The cause of the NDA/BJP+ small vote-share difference against the sample.

## 13. Decisions still to confirm during planning

- Canonical focal and contender identity names in `cards.yaml` against the preset (`NDA`, `SP+`, `BSP` were used live).
- Whether `seat_results` stays in the card payload (size).
- Whether the dashboard's own engine adapter (`runner/engine.py`) can call the host benchmark loaders as-is, or needs a thin seam.
