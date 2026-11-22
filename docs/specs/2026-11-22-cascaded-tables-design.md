# Cascaded tables, Pop % column and hierarchical display order

Status: draft for owner approval, 2026-11-22.

## Intent

Analysts read demographic cuts as one nested table: an age group with its genders beneath it, a category with its castes beneath it, in a fixed house order, with each row's population share beside it. Today each cut renders as its own flat table, order rules only reach single-dimension cuts, and the engine's population share is dropped by the translator.

## Goals

1. **Cascaded** becomes a Density option on grid cards. Nested cuts (`[age_group]`, `[age_group, gender]`) render as one tree: parent row, children beneath.
2. **Pop %** is a fixed second column (after the row label) on grid cards whose family returns `populations`, in every density. It is the engine's `composition_share` as returned (share of the whole population), read from the **anchor round**, whether the anchor is the default or a per-card override.
3. **Order rules reach every level**, including children, with a per-parent order for castes within a category. State YAML for Uttar Pradesh sets: gender (Male, Female; `Other` stays hidden), age group (youngest first, `60+` last), category (GEN, Yadav, NY-OBC, Jatav, NJ-SC/ST, Muslim), castes within a category (named castes, then `Other <category>` last).
4. **Caste clubbing uses the anchor round as its reference for every round the card reads.** The anchor's geography decides which category-caste pairs keep their own row. All other rounds reuse that membership; a caste the anchor has no mapping for falls into `Other <category>` (engine behaviour, `unseen_caste`).
5. Compact is removed from grid-card Density (Standard, Detailed, Cascaded remain).

## Non-goals

- Bold / grey row-and-column styling from display rules: the next slice, after this one is verified.
- Front-end editing of rules (YAML per state, edited by the owner).
- Ranking and relationship cards (ranking keeps its own Compact/Standard/Detailed).
- Any arithmetic in the browser: parents, totals and shares are engine values.
- States other than Uttar Pradesh.

## Anti-goals

- A cascade that computes a parent by summing children in the browser.
- Different caste membership in different survey columns of one card.
- Invented age-group labels, orders or population values.
- Silently showing a different survey's population when the anchor has none (show a dash).

## Constraints

- ClickHouse does the numbers; Python orchestrates and formats; the browser pivots and copies (project rule).
- Missing value is a dash, never zero. No "pp" in any label.
- Engine: caste clubbing needs `category` and `caste` declared single-valued for every observation, the reference must be one of the request's own observations (`caste_clubbing.py:34`), and a missing reference geography is an error.
- Backend translator already keys rows as `age_group=18-25|gender=Male` per cut (`g0`, `g1`, ...); `_apply_row_rules` currently orders single-dimension cuts only; `_population_rows` creates rows but discards the value.
- **Rules are plain data, easy to read and edit in the backend (owner, 2026-11-22).** Every order, hide, label, colour and later style rule lives in `config/presentation/*.yaml`, one short entry per field, with no field-specific code (no "if gender" or "if age_group" branches). Adding or changing a rule means editing YAML only. The registry is the single reader: `api/app.py` stops re-parsing the YAML itself and asks the registry. A mistake in a rule file fails at load with a message naming the file, entry and key. `docs/` gets one short guide with a commented example per rule type (order, `pin_last`, `within`, wildcard, `hidden`, `labels`, `colours`), including the UP gender, age, category and caste entries.
- The owner's uncommitted edit to `docs/specs/2026-11-08-dashboard-design.md` is never touched.

## Approaches considered

- **A. Backend emits a finished tree.** Most work; duplicates what the cuts already carry. Rejected.
- **B. Backend supplies data, front end draws the tree (chosen by owner).** Backend: Pop % as a real column, order at every level, caste reference. Front end: nests cut rows under parents in the Cascaded density.
- **C. Front end only.** Cannot obtain Pop % or set the caste reference. Rejected.

## Design

**Cascadable cuts.** A card is cascadable when its cuts form a chain in which each set extends the previous by one field and every parent set is present (`[a]`, `[a,b]`, `[a,b,c]`). Otherwise Cascaded is disabled with a reason ("needs each cut to start from the previous one"). A parent is always a cut the engine ran, never a sum made here.

**Tree rules.** Parent row = the coarser cut's row; children = rows of the next cut whose key starts with the parent's. A parent whose only child has the same label as the parent shows as one row (Yadav, NY-OBC, Jatav, Muslim: category with a single caste of the same name). A child with no parent row in the payload is shown at the top level, never dropped. Hidden values (gender `Other`) drop their rows at every level.

**Order.** Each level is ordered by the registry (`order`, `pin_first`, `pin_last`, `unknown`, `hidden`); a rule may apply within one parent (`within`; the builder confirms how the registry's existing `within` selects a parent, and extends it if it does not). `Other *` pinned last uses the registry's prefix wildcard. Unlisted values follow the registry's existing policy.

**Pop % column.** Backend adds a fixed column keyed apart from party/option columns, filled from `populations` for the anchor round per grouping set and row; not a lens, not removed by lens/party selection. One column regardless of how many questions or surveys:

- several questions, one survey: one Pop % column (population does not depend on the question);
- one question, several surveys: one Pop % column, anchor round only; other surveys' own shares are not shown.

If the anchor has no population item for a row, the cell is a dash.

**Caste reference.** `caste_reference` becomes the anchor round always (today: compare reference, else anchor, else last round). "Club small castes" defaults on for new cards whose cuts include `caste`. For the several-surveys path, which runs one engine job per survey with only that survey's round, the builder must make every job clubbed by the anchor's membership (for example by including the anchor as an additional observation of each job and dropping its rows from other surveys' results, or by one multi-observation job when no survey skipped questions), proving identical membership across survey columns. **Decision (Task 1, 2026-11-22): `extra_observation`, conditional.** The engine requires every request scenario in every observation (`validation.py:95`) and the caste reference to be one of the request's observations (`caste_clubbing.py:34`). So each per-survey job lists the anchor as an additional observation, only when the anchor asked all of that survey's questions; the anchor's rows are dropped from other surveys' results. A survey whose questions the anchor did not ask is reported unavailable with that reason (clubbing can be switched off for it); there is never a silent per-survey fallback. A card whose anchor lacks category/caste, or lacks a geography the card reads, is unavailable and names the round, following the existing unavailable pattern. No silent per-survey fallback.

**Density.** Card views are in memory, not stored, so no migration is needed. Grid cards get their own `GridDensity = "standard" | "detailed" | "cascaded"`; the shared `Density` type keeps `compact` for ranking cards. The `compact` branch in `partsFor` (drops the trend part) is removed; trend visibility stays controlled by Show. When a card's cuts are cascadable its initial density is Cascaded (the owner's "by default"); otherwise Standard.

**While Cascaded (my calls, 2026-11-22).** The cut selector is ignored (the whole chain is one table). Transpose and column sort are unavailable, because both would destroy the tree. Search keeps a matching row and its parents. A cut whose first field is a seat field (shown as a selector, not rows) is not cascadable in this slice; the reason is shown.

## Verification

- Backend fixtures where likely wrong implementations fail: Pop % taken from the wrong survey (give surveys different populations); child shares not summing to the parent is fine and must not be "fixed"; parent value must equal the engine's coarser-cut value, not the children's sum.
- Order tests at every level, `within` per parent, `Other *` last, unlisted values, hidden `Other` at both levels, null values.
- Collapse rule: single-child-same-label parent shows one row; a parent with one differently named child keeps both.
- Caste membership identical across survey columns in a several-surveys card; a caste unseen in the anchor lands in `Other <category>`.
- Front end: cascadable/non-cascadable cuts, density migration, dash for missing Pop %.
- Live read-only run on UP (aggregates only) for a category→caste cascade with two surveys; production checks not run unless stated.

## Left to the builder

Column key naming, payload field names, CSS and the indent/expand styling of child rows, whether parents are collapsible (default: all expanded), exact `within` mechanics, and the per-survey caste-reference mechanism above (constraint fixed, method open).

## Open items needing data, not decisions

- The real age-group labels in UP's surveys must be read from the data before the order list is written; none are assumed here.
