# Multi-survey contexts and multi-question / multi-survey card layouts (design)

Status: draft for owner approval, 2026-11-21. Not built. Sparklines and trend graphics are out of scope (owner: later).

## Intent

Analysts want one context to hold surveys of different levels, and grid cards to compare several questions or several surveys in one table. Today a context has a single `level` and a card has one question set; selecting several questions gives unpredictable layouts.

## Goals / non-goals / anti-goals

Goals: levels per survey in a context; level and seat-attribute validation per card from the card's selected surveys; defined row/column layouts for multi-question and multi-survey cards; trend survey selection (last N or custom); saved cards survive only when their context is reused.

Non-goals: sparklines/graphs; engine changes for mixed-level runs; new numerics.

Anti-goals: the browser computing any number (it only pivots engine values); silently dropping a user's card in a changed context without saying so; a per-context-level "coverage" intersection where no seat-level cut exists.

## Decided rules (owner)

1. **Levels.** A context may hold surveys of any levels in any combination. What a card can do depends only on the set of levels among the surveys that card selects (anchor, compare, trend or survey picker):

| Selected surveys | Offered |
|---|---|
| only AC | everything, seat features at AC level |
| only PC | everything, seat features at PC level |
| only state-wide and/or zone | anchor, compare, trend, overall and respondent-attribute cuts; NO seat features |
| any other mix (AC+PC, or AC/PC with zone/state-wide) | same as the row above: NO seat features |

2. **Seat features** (seat ranking, group/demographic ranking, seat benchmark, seat-level attributes in distribution cuts, seat cohorts) need every selected survey to be the same seat level. Check: unique levels of the card's selected surveys; more than one level, or a zone/state-wide level -> blocked; exactly one seat level -> that level. The picker for these cards does not offer surveys of other levels; if the anchor is one, the card is not buildable. The rule is per card, so a context holding AC, PC and state-wide surveys still builds a full AC card when that card's anchor/compare/trend surveys are all AC.
   Only the seat identifiers themselves (`ac_num`, `pc_num`) are withheld in mixed or non-seat sets. Other geographic and seat-attribute cuts (zone, party_zone, district, incumbent party, ...) stay available and become rows or columns like any cut.
   **Geographic cuts follow per-survey field availability, not the v1 level table.** Checked read-only against the live catalogue (2026-11-21; Assam, Bihar, Delhi, Gujarat, UP, West Bengal): no survey at any level lists `zone`, `party_zone`, `pc_zone` or `district` as a field, so these come from the seat master through `ac_num` / `pc_num`; zone and state-wide surveys list `ac_num` (owner confirmed: every zone/state-wide survey has `ac_num` on every respondent), and `pc_num` on some (UP state CAPI R1-R3 lack it; R4+ and CATI have it). Rule: a cut over `zone`, `party_zone`, `district` or incumbent party is offered when a survey lists `ac_num`; `pc_zone` needs `pc_num`. A survey lacking the needed field shows "not available" in that cut while the other surveys in the card show values. The `geo_slices` table in `capability.py` (from design spec 2026-11-08 section 5, a v1 decision, not metadata) is replaced by this check.
   **Weighting is not a gate.** A state-weighted survey sliced by zone/district is allowed with no flag or block, the same as occupation is used as a cut on an AC survey that is not weighted by occupation. Seat-level cards and `ac_num`/`pc_num` cuts remain governed by rule 2 (a stored seat number does not justify a seat estimate).
3. **Coverage.** With no seat-level cut in a mixed-level or multi-survey card, no common-coverage intersection is applied: each survey uses its own coverage.
4. **Layouts** (grid cards, distribution and opinion families):

| Questions | Surveys | Split by | Rows | Columns |
|---|---|---|---|---|
| several | one | overall | party / opinion breakdown (+ net score) | questions |
| several | one | any cut | cut values x breakdown | ONE question, chosen as a filter |
| one | several | overall | surveys or breakdown (axes swappable) | the other axis |
| one | several | any cut | cut values x breakdown | ONE survey, chosen as a filter |
| several | several | overall only | surveys | questions; one measure only (net score, or one party's support share) |

Cuts are disabled for several-by-several.
5. **Trend** gets a survey choice: the last N surveys, or a custom set from the context. A custom set is saved with the card.
6. **Saved cards.** Each saved card carries a fingerprint of the context it was built in. Reopening the same context restores all cards. In a changed context, cards that no longer validate (missing survey, level rule) are removed from the canvas, with a one-line notice of how many.

## Approaches considered

- **A. Per-round level pairs in the context** (`rounds: [{level, round}]`) with a one-time migration of old contexts. **Superseded 2026-11-21:** the catalogue is keyed by `(state, base_name)`, so a round name already identifies exactly one level; pairs add nothing. The context keeps `rounds: string[]`, `level` becomes an ignored legacy field, and levels are derived from the catalogue (see plan `docs/plans/2026-11-21-multi-level-context.md`).
- B. Keep `rounds: string[]` plus a `levels` list, resolving a round's level by catalogue name. Smaller diff, but ambiguous if a name exists at two levels.
- C. One context per level. Does not meet the request.

For layouts: the engine already returns per-observation cells and trend rounds, so orientation is a frontend pivot in `payloadToGrid`; the one-measure rule and level rules are backend validation in `CardConfig` and `template_blockers`, so the browser never enforces numerics.

## Build order (each its own plan)

A. Context model, URL/last-context migration, context bar multi-level picker with the AC rule.
B. Level validation (`template_blockers` over the card's selected surveys), picker filtering, coverage rule (force independent coverage when no seat-level cut).
C. Survey picker on grid cards, layout table above, cut-to-filter behaviour, several-by-several measure rule.
D. Trend last-N / custom survey set, context fingerprint on saved cards and removal on mismatch.

## Constraints

CLAUDE.md rules apply: ClickHouse does calculation; unavailable data is never invented; display state never goes into engine requests; commit explicit paths only; do not touch the owner's edit to `2026-11-08-dashboard-design.md`.

## Left to the builder (my calls, correctable)

- Exact wording of blocker messages and the "N cards removed" notice.
- Default axis for one-question-several-surveys overall: surveys as rows, with a swap control.
- Fingerprint = state + sorted (level, round) pairs + anchor + compare round + version mode.
- Whether PC-level seat cards share the AC ranking code path with `pc_num`; the builder confirms against the engine (`SEAT_DIMENSIONS` already lists `pc_num`) and reports anything unverified rather than assuming.
