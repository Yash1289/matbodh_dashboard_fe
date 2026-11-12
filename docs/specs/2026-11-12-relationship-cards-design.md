# Relationship Cards — Design Specification

| | |
|---|---|
| **Status** | Draft for review (brainstormed with the product owner, 2026-11-12) |
| **Project** | `matbodh-dashboard` |
| **Sub-project** | 5a of 6 (5 is split: 5a relationship card, 5b seat cohorts) |
| **Builds on** | `2026-11-10-card-foundation-and-grid-family-design.md`, `2026-11-11-ranking-cards-design.md`, `2026-11-12-benchmark-cards-design.md` (CardConfig, CardShell, ControlStrip, runner, per-job cache, alliance major-party provider, method drawer) |
| **Engine contract source** | `MatBodh-Dash`: `docs/usage.md` (Scenario relationships), `docs/guides/scenario-relationships.md`, `examples/distribution_transition.json`, `sample-output/result_transition.json`, `sample-output/result_transition_complex_mcap.json` |

---

## 1. Intent

One card family, `relationship`, that shows how respondents answered two party questions of the **same survey row**: an origin question (for example the recalled vote `vs_past`, or `mla_choice_party`) and a destination question (for example `vs_voting_intention`). It is a recalled-to-current relationship, not a panel: the engine returns one matrix per round and never joins respondents across rounds (`cross_round_pairing: false`). The engine owns every number. Python and TypeScript copy, filter and lay them out; they never recompute a share, a flow or a base.

## 2. Scope

### 2.1 In scope

- Family `relationship` in the existing `CardConfig` / `cards.yaml`.
- Two display tables from one engine run: **Flow summary** and **Matrix**.
- A runner path for `EngineJob.kind == "relationship"`, a relationship payload and a card body.
- Joint weight `base` or a scenario donor; optional inclusion of the recalled statuses `Did Not Vote` / `Do Not Remember` on a recalled endpoint.
- Any survey level the capability table allows for the chosen cuts.

### 2.2 Out of scope

- Inter-round comparison or deltas. The contract has none. A trend shows each round's own values side by side.
- Other party grouping (the engine rejects it for relationships), explicit party option universes (see §10, they close the answer set and fail), per-endpoint alliance versions (one default survey mapping on both axes, see §3).
- Rows or columns for parties other than the major parties; the long tail of independents is not shown and not summed.
- Seat cohorts, seat selection and the investigation drawer (sub-project 5b). The card must run unchanged with a cohort filter later (§11).
- The Configure modal (sub-project 6): starter cards are chosen by the engineer in `cards.yaml`.

## 3. Rules from the product owner

1. **Focal party is fixed in the card config**, like the benchmark's. It is not a chip.
2. **One alliance mapping on both axes.** Relationship reads two columns of one survey, so the survey's default alliance mapping applies to origin and destination. The method drawer shows its version.
3. **Major parties only.** The matrix keeps only transitions between the major parties of the alliance table. With majors `NDA`, `SP+`, `BSP` that is all nine ordered pairs, the three diagonal pairs included and marked "stayed".
4. **Grouping cuts become filters.** Each cut dimension (for example gender) is a filter chip; the matrix shows the selected group.
5. **Matrix columns are exactly four:** Origin share %, Destination share %, Joint share %, Size of impact (pp). Counts and bases go to Details.
6. **Flow summary shows:** Net flow (pp), Retention share %, Gained population share % and Lost population share % side by side, and Acquisition share % (the one extra metric). Everything else goes to Details.
7. **No number is invented.** A major-by-major cell the engine emitted no row for is a dash with the reason "no respondents moved", never a zero.

## 4. `CardConfig`: engine part and view part

```yaml
- id: relationship.up_past_to_current
  family: relationship
  section: relationships
  title: Past vote to current choice
  cuts: [[], [gender]]            # grouping sets, as on the grid cards
  relationship:
    origin: vs_past
    destination: vs_voting_intention
    focal_party: NDA
    weights: {source: base}
  view: {table: summary}          # never part of the engine config or its fingerprint
```

`RelationshipConfig` (engine part, everything here changes the run): `origin`, `destination`, `focal_party` (optional; without it the engine returns agreement only and the Flow summary shows Agreement alone), `weights` (`{source: base}` or `{source: scenario, scenario, mode: mj_cap|m_cap}`), `include_recalled` (`origin` and/or `destination`: a subset of `Did Not Vote`, `Do Not Remember`, only for a scenario with role `recalled_vote`).

Validation at load: origin and destination are distinct party-domain scenarios; `include_recalled` names a recalled endpoint and only the two allowed labels; a scenario donor is a party scenario; `scenarios`, `comparison`, `caste_clubbing`, `rank`, `benchmark` are absent on a relationship card. `cuts` follow the grid rules (no duplicate set or attribute).

`RelationshipViewConfig` (display only): `table: summary | matrix`. Two cards differing only in `view` share one engine run.

### 4.1 Major parties and the focal party

The major parties are what the alliance table maps for the survey (the same `MajorPartyProvider` and per-epoch cache as the benchmark). Display order comes from the presentation rules for field `party`; parties without a rule sort alphabetically after. The focal party must be one of them; otherwise the card is unavailable with the reason (a focal party outside the mapping would be folded into the unmapped tail and its flows misread).

## 5. Compile and run

- **One job per card**, `EngineJob("relationship", "relationship", GRID, config)`. All asked rounds are observations of the one request; the engine returns one matrix per observation, so there is no per-round fan-out. A round lacking either scenario is reported as "not asked in …" (existing `not_asked`); the anchor round lacking one makes the card unavailable.
- **Request** (existing `build_request`): preset weights and answers, `scenarios = [origin, destination]`, `grouping_sets = cuts`, no comparisons, no gender differential, no Other grouping (`other_grouping=False`), `coverage_mode: independent`, no reference observation. Alliances resolve through the view config's `alliances.reporting_type`, as other cards.
- **Operation:** `relationship: {id: "relationship", origin, destination, weights, focal_party, answer_overrides?}` in `view_config(..., relationship=...)`. The id is a constant (not the card id) so copies share one fingerprint, as with the benchmark.
- Runs through the existing `NamedSurveyRuntime` path (the engine runtime already dispatches on a `relationship` key). Queue, per-job cache, fingerprint, retries and error kinds are reused unchanged.
- **Capability:** cuts are validated against the context level with the existing `template_blockers`; an unavailable reason is returned before any run.
- **Failures at compile time** (each becomes an `unavailable` reason): focal not in the alliance mapping, alliance table unreadable (typed `AllianceUnavailable`, no raw cause shown), origin or destination not asked in the anchor round, a cut the level cannot support.

## 6. Payload (`RelationshipPayload`, mirrored in `web/src/api/types.ts`)

Every number is an engine value copied unchanged.

| Field | Content |
|---|---|
| `kind`, `family`, `card_id`, `state`, `rounds` | as the other payloads |
| `origin`, `destination`, `focal_party`, `weights` | scenario ids and the weight policy |
| `parties` | the major parties in display order |
| `groups` | one entry per grouping-set value: `set_id`, `dimensions` |
| `cells` | per `round`, `group`, `origin`, `destination` (major by major only): `origin_share`, `destination_share`, `joint_share`, `size_of_impact_pp` (the four display measures), plus `joint_count`, `joint_mass`, `origin_base`, `destination_base`, `paired_base`, `paired_count`; an absent cell has every number `None` and `absent: "no_respondents"` |
| `summaries` | per `round`, `group`: `paired_count`, `paired_base`, `agreement_share`, and with a focal party `retention_share`, `loss_share`, `acquisition_share`, `conversion_share`, `retained/lost/gained/neither_population_share`, `net_flow_pp`, `composition_share`, the impact fields, `focal_origin_base`, `focal_destination_base`, the four masses |
| `contract` | `relationship`, `identities`, `joint_weights`, `eligibility`, `normalisations`, `focal_bases`, `population`, `units`, `cross_round_pairing` (not `source_contracts`, not `operations`) |
| `not_asked`, `unavailable`, `rules_version`, `engine_version`, `metadata_revision`, `alliance_epoch` | as the other payloads |

Only cells whose origin and destination are both major parties are carried. Shares keep the engine's bases, which include the smaller parties, so a row of the matrix does not add to 100 over the major destinations only. Two sample facts bound this: in every large group of both samples the nine major cells hold 95-97 % of paired respondents; the footnote says so in words, no sum is computed.

## 7. Card body and controls

- **Chips:** Table (Flow summary, Matrix), Round (Matrix only), Cut (when more than one grouping set), one value chip per dimension of the chosen cut (Matrix), Search, Details, Export CSV, method drawer, Refresh. Display chips never start a request.
- **Flow summary** (default): one row per group value, each cell shows the rounds as pipes, one segment per round (values side by side, no deltas). Columns: Net flow (pp), Retention share %, Gained population share %, Lost population share %, Acquisition share %. Header tooltips name each base ("of those who were NDA before"). Without a focal party: Agreement share % only. Details adds agreement, loss, conversion, the neither share, the impact fields, composition, `focal_origin_base`, `focal_destination_base`, the masses, N and the paired base.
- **Matrix:** rows are ordered pairs, origin to destination, over the major parties (the diagonal marked "stayed"); columns Origin share %, Destination share %, Joint share %, Size of impact (pp). The focal party's rows and columns are emphasised. Details adds `joint_count`, `origin_base`, `destination_base`, `paired_base`, `paired_count`.
- **Footer:** "Recalled vote, not longitudinal linkage" (for a recalled origin; for `mla_choice_party` "same-row answers, not a panel"), "Shares include respondents who chose smaller parties", coverage note, method line (rules, engine, metadata revision) as the other cards.
- **Method drawer:** the contract fields, the joint-weight policy, the alliance identity version, the eligibility rule, the recalled inclusion and the units.
- **Tiny groups:** a group with a very small N (the gender `Other` group has 8-11 respondents in both samples) is shown like any other, with N under Details. No low-base flag until the owner sets the global threshold.

## 8. Errors and states

As the benchmark: a plan with `unavailable` reasons renders the reasons and no table; a failed job renders its kind-specific message and Refresh; an infrastructure error is never shown raw; a partial run (not possible with one job) is not a state here. While a new run is in progress the old subtitle, chips and drawer are not shown.

## 9. Testing

**Backend (`tests/cards/`):** config validation (every rule in §4); compile (job config shape, weights and `include_recalled`, constant id, view-only difference gives an identical config, focal outside the mapping, alliance unreadable, scenario not asked, cut unavailable at the level); translate against a copy of the real engine result (aggregates only, `tests/fixtures/engine_samples/result_transition.json`): every displayed number equals the engine's (for example R2 Male retention 74.017 against the focal origin base, not the paired base; net flow -7.806), the diagonal is present, an absent major cell (R2 Other, `BJP+` to `SP+`) is a dash with the reason and no zero, only major-by-major cells are carried, summaries without a focal party carry agreement only, nothing is summed in Python; an engine-loader test that the compiled job config passes `relationship_from_dict` and the engine's offline resolve (as the benchmark and ranking cards do).
**API:** the plan and run endpoints accept the new family and return the payload.
**Frontend (vitest):** table chooser, round and value chips, diagonal marking, dash for an absent cell, Details contents, search, CSV, no fetch on any display control, stale text cleared during a re-run, unavailable state.
**Live smoke (VPN, owner's go-ahead):** `scripts/smoke_card.py` for both starter cards (UP, R1+R2): job state and timing, group and cell counts, the focal identities `retained + lost + gained + neither = paired base` on the engine's own values.

## 10. Live evidence (2026-11-12, UP, read-only, owner approved)

- All focal identities reconcile in both samples (12 group-round summaries): the four flows add to the paired base; focal origin base is retained plus lost; focal destination base is retained plus gained; retention plus loss is 100; population shares add to 100; net flow is (gained minus lost) over the paired base; the net-flow impact is net flow times composition over 100. They were recomputed from the matrix rows and match.
- Matrix shape: 1,007 rows for two rounds and three gender groups, up to 319 cells and 109 origin parties in one group, while the three major parties hold about 97 % on each axis.
- A live relationship run with explicit party options `[NDA, SP+, BSP]` and passthrough failed in ClickHouse (`ILLEGAL_DIVISION`): an option list closes the answer set and any eligible answer outside it aborts. Options therefore cannot produce zero cells for the majors, and the card runs without them.
- The same config with `coverage_mode: independent` and one observation passed engine validation (it reached SQL): no cross-round alignment is needed.

## 11. Not verified

- A relationship job through the dashboard runner on a live database (the engine CLI path is the only live evidence).
- The `mla_choice_party` starter card with a scenario joint weight live.
- PC-level and cohort-filtered relationship runs (5b). The engine documents a selection plus a downstream relationship; a plain `ac_num` filter was shown equivalent for distributions, not yet for relationships.
- The engine's own behaviour for a focal party outside the mapping (the card refuses before running).
- The alliance labels: the stored samples say `BJP+`, the dashboard's live alliance table says `NDA`; tests copy labels from the fixture, the live smoke settles it.
- A low-base threshold (owner decision still open).

## 12. Deferred

- Sort / Density chips; a Duplicate-card button (sub-project 6).
- A stacked bar of the four population shares in the Flow summary (display of engine numbers, only if wanted).
- Per-endpoint alliance versions for the recalled axis (needs the engine specificity work noted in the dashboard design spec).

## 13. Decisions to confirm

1. Acquisition share is the fifth Flow summary column (the "one extra metric"). One line to drop.
2. Flow summary lists every group value as a row; only the Matrix uses value chips.
3. Undecided, NOTA and unmapped destinations are not shown as matrix columns; they remain inside the bases and the focal flows.
