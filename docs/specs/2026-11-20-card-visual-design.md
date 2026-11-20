# Card visual design: decisions

Status: mock-ups approved at the overall level on 2026-11-20. Not yet built. Logic is unchanged by this work; it restyles the cards and the Configure panel.

The mock-ups are browser pages in `docs/mockups/`:

| File | Shows |
|---|---|
| `grid-card-polished.html` | The grid card (distribution, opinion, gender gap) at wide, medium and narrow widths |
| `other-cards-polished.html` | Seat ranking, demographic ranking, seat benchmark, relationship |
| `configure-panel-polished.html` | The Configure panel: standalone, compare with More options open, and an incomplete card |
| `seat-selector-polished.html` | The seat-attribute selector (placeholder numbers) |
| `trend-and-cohort-polished.html` | Seat ranking in trend mode, and the Make cohort flow |
| `benchmark-tabs-and-narrow-polished.html` | Benchmark Comparison, Margin buckets and Seat flips tabs; ranking, benchmark and relationship at 340px |
| `configure-pickers-and-families-polished.html` | The pickers (question, election, party, field, metric) and the Configure panels for gender gap, seat ranking, group ranking and vote movement |
| `grid-card-options.html` | The first two options, kept as history. Superseded. |

Numbers in the mock-ups are from the test fixtures (Uttar Pradesh, anchor R2), except where a page says they are placeholders.

## 1. One control system for every card

- **Chips for choices, tabs for the main reading of a card.** A chip that differs from its default is tinted blue with a dot. A chip at its default is plain. Colour is never the only signal.
- **Lens and other tabs.** Shown as tabs only when the card is wide and has three lenses or fewer. A chip when there are more than three, and always a chip on a narrow card (decided 2026-11-20). The same narrow rule applies to the benchmark's four tables and the relationship's Summary and Matrix: they become a chip.
- **View menu.** Secondary settings (Format, Cell parts, Density, Details, Find and hide, How this was calculated, Export CSV) sit in one View menu. Each row shows the setting's current value, and the chip shows how many are changed. At medium width Format moves into this menu.
- **Display controls never run the engine.** Lens, cut, sort, format, density, transpose, search, hide and the seat selector are display state only.
- **Heat is a soft tint**, not a saturated fill. A one-line legend says what the tint means.
- **Numbers.** Tabular, lining figures. The value is the largest element in a cell. The change is smaller, with an arrow so it does not rely on colour.
- **Focus.** Every control has a visible 3px blue focus ring. Text meets AA contrast. Footer and secondary text is at least 12px.

## 2. Cards adapt to the width the canvas gives them

- Narrow, medium and wide are decided by the card's own width (container queries), not the window's.
- **Table text scales with the card.** The table reads its own width and sets one base size: `clamp(10.5px, 8px + .57cqw, 13px)`. Everything in the table is in `em` from that base (headers, row labels, values, changes, cell padding, column minimums). Measured: 13px base at 880px wide, 11.2px at 560px, 10.5px at 300px or less. Never below 10.5px.
- **Narrow tables keep every column.** They scroll sideways with the first column pinned. The pin shows a soft edge once content has scrolled under it. Columns are never hidden.

## 3. Card families

- **Seat ranking.** Rank badge (top three tinted), seat name with its AC number beside it in small text, a proportional bar behind the value, an order chip, a seat search box, and "Show 100 more".
- **Demographic ranking.** One collapsible group per seat holding its top castes, instead of repeated header rows. Ties keep the engine's "=1" marking.
- **Seat benchmark.**
  - The engine's tables are tabs: Summary, Comparison, Margin buckets, Seat flips.
  - The reference (for example 2022 VS) is a chip. It is tinted because it is not "no reference".
  - **Summary layout:** parties are the columns. The first row is always **All seats (the overall row)**, followed by one row per group value (for example each party_zone). Each cell merges vote share and seats: value, arrow and change on one line, seat count, arrow and change on the next. The reference year is stated once, in the chip, and is not repeated in every cell.
  - Where a group has no figure for a party, the cell shows a dash. Nothing is invented.
- **Relationship.** Summary and Matrix are tabs. A Female/Male selector switches the group. In the matrix, each cell is tinted by share and the "stayed" diagonal is outlined. A note says rows do not reach 100% because smaller parties are left out.

### Added 2026-11-20

- **Trend mode (seat ranking).** One column per round, up to four. Each cell has the rank badge, the value and the movement since the previous round (▲ n, ▼ n, =, or "new" when the seat was not ranked before). The first round has no movement. A seat with no valid result in a round shows "Not ranked". Wide tables scroll with the seat column pinned.
- **Make cohort.** An item in the card menu on every seat ranking and seat benchmark card (not demographic ranking). Step 1 shows the card's own settings read-only and asks only for the rule: on a ranking, "ranked in the top N" (ties at the cut-off included, optional score limit); on a benchmark, which side to read plus a status, a margin range or a flip class. Step 2 previews the seat count and a short list, kept in the browser session only, with a separate "Use as cohort" confirm; zero matches disables it. Step 3 is the cohort tab: the context bar shows the cohort name, seat count and time with a clear control, and the first card is the overall vote share, shown as a loading row until it runs.
- **Benchmark tabs.** Comparison: every number side by side with grouped headers (Vote share: R2, reference, change; Seats won: R2, reference, change, share of seats). Margin buckets: six rows from "ahead by 10 or more" to "behind by 10 or more", a bar and a count per side, plus a total of 403; ahead and behind are written out as well as coloured. Seat flips: one proportional bar and a table of the four classes (won in both, gained, lost, lost in both) with what each means. Margin buckets and flip rows each carry a Make cohort control.
- **Narrow cards (340px).** Seat ranking: rank badge, seat with AC number and a thin bar under the name, value. Benchmark: table chooser as a chip, Summary scrolls with row labels pinned. Relationship: view chip, group selector kept as a two-option segment, matrix scrolls with the "voted for" column pinned.
- **Configure pickers.** One shape for all: a field showing the current choice, a list beneath, search when long, radio for one and check box for several, unavailable options greyed with the reason. Question picker groups party and opinion questions and marks recalled ones; the election picker offers no reference, the comparison round (only when there is one) and past elections; the party picker greys a party not mapped for every endpoint; the field picker groups respondent and seat fields (using `scope`) and badges seat fields; the metric picker follows the chosen question.
- **Other families in Configure.** Gender gap (no Compare; gender is not a split because it is the result; Rounds to show in trend), seat ranking (Seats AC or PC, Rank by, Party added for a party question, Top N, Rank within, Only seats where), group ranking (Groups, Top N required, Rank within), vote movement (From, To, Split by, Focal party, Also count for recalled questions, Pair answers with). Opinion is Party vote share with opinion questions.
- **Labels.** The options endpoint returns the question id as its label today. The pickers show a friendly name with the id beside it, so a label source is needed before building.

## 4. A seat attribute that comes first in a cut becomes a selector

Set as a fixed rule on 2026-11-20.

- When the first field of a crossed cut describes the seat (`ac_num`, `party_zone`, `incumbent_mla_*` and similar), the card shows it as a selector. The table shows the remaining fields for the chosen value.
- The calculation is unchanged: the engine still computes the whole crossed grouping set in one run. Choosing a value is display only.
- The selector is a stronger chip than the others, because it decides which seats the table describes. It has previous and next arrows, a position ("2 / 16", "128 / 403"), a searchable list, and an "All" option.
- A seat field that is not first is an ordinary row or column field. A cut that is only a seat attribute (`ac_num` alone) has nothing left to show, so it stays as plain rows with no selector.
- Only the first field becomes a selector, even when several are seat-level.
- In Configure, the cut builder tints a seat field that is first in a cut and shows a one-line note. A seat field that is not first gets neither.
- **Backend (done, uncommitted).** Field options carry `scope`: `"seat"` for engine fields with role `seat_attribute` or `geographic_attribute`, `"respondent"` for the rest, and null for non-field options. `matbodh_dashboard/cards/configure/options.py`, `web/src/api/types.ts`, tests in `tests/cards/test_configure_options.py`.

## 5. Configure panel

- A side panel of about 440px, opened from a card's menu or from "Add card".
- Lists the family's own fields, primary fields first. The descriptor's `tier: more` fields sit under "More options", which shows how many are set.
- A field appears only when its condition holds. For example, choosing Compare reveals Question and Compared with in a tinted block. A party question compared with an opinion question shows a "Shakti comparison" note.
- Nothing runs until Apply. Apply stays disabled until the engine says the card is valid, and the footer says what is wrong. Errors appear inline at the field. Alert wording comes from the engine.
- The cut builder is a list of tables. Fields within one table are crossed ("Fields in one cut are crossed").

## 6. Colours to carry into the real app

Measured contrast: muted text `#5b6472` (5.58 on the table header fill), gain `#0a6c41` (5.84 on its tint), loss `#b42d2d` (5.48 on its tint). The earlier `theme.ts` values `#6b7380` (4.46 on the header) and `#0d804d` (about 4.4 on its tint) were marginal or failing. The mock-ups still hold two loss values (`#bf3333` on the grid and other cards, `#b42d2d` on Configure and the selector). Unify to `#b42d2d` when building. The icon grey `#8a919c` is 3.18 and is for icons only, never text.

A single token source for the main UI is wanted. The mock-up-stage token file was tried and reverted at the user's request, because it changed how the pages looked and rendered. Carry the values into `web/src/theme.ts` at build time, as its own step.

## 7. Not drawn yet, or not decided

- Opinion's Configure panel (it differs from Party vote share only as described above).
- Narrow and medium widths for the Configure panel and its pickers (a full-screen sheet is expected on a phone).
- Empty, loading and error states beyond the cohort's loading row. Dark mode.
- Margin buckets and Seat flips at the other groupings (the mock-ups show the all-seats group).
- A friendly-name source for questions (see Labels).
- How the selector's "All" value is produced for every cut (the engine's subtotal rows may supply it) and how thin respondent bases per AC are marked.
- The four-round trend and the zone and cohort examples use placeholder numbers where the fixtures have none.
- Copy tone. A pass to sentence case and plain subtitles was tried and reverted. The current copy stands.

## 8. Build order

1. Restyle the cards and Configure panels to these mock-ups, keeping logic unchanged and tests green.
2. Add the seat selector to the result view, using `scope`.
3. Then the canvas and tabs (sub-project 6b), then the context step and saving (6c).
