> Superseded by [2026-11-10-card-foundation-and-grid-family-design.md](2026-11-10-card-foundation-and-grid-family-design.md): its body adapters and payloads did not match engine output.

# Universal Card Component Architecture — Design Specification

| Document Metadata | Details |
|---|---|
| **Status** | Approved by User / Ready for Implementation Planning |
| **Date** | 2026-11-10 |
| **Project** | `matbodh-dashboard` (Frontend Component Architecture) |
| **Engine Contract Source** | `MatBodh-Dash` 0.8.0, `sample-output/configs_v2/` (26 contracts), `datacut-families.yaml` |
| **Design Standard** | Figma Frame A (`KAwwifuB30DnFUatxqYVN6`), UI/UX Pro Max Design Intelligence |

---

## 1. Intent and Problem Statement

The MatBodh Survey Analytics Engine returns high-dimensional election analytics across several distinct mathematical families: categorical distributions, demographic cross-tabs, caste cascades, gender differentials, election benchmarks, seat flip buckets, multi-leader opinion scorecards, metric rankings, and voter transition matrices.

To scale the dashboard across all five planned sections (State Pulse, Seat Battleground, Voter Coalitions, Leadership, Vote Movement) and future custom datacuts:
1. We must support **all output structures** produced by the engine contracts in `configs_v2`.
2. Cards must provide rich spreadsheet-like interactivity: **multi-measure toggling** (Row % vs Col % vs Impact), **standalone vs. comparison modes** (with up to 4-round trend pipes), **Google Sheets-style red-to-green conditional formatting** (scoped by column, row, or table), **hierarchical attribute filtering**, **transpose ($\rightleftarrows$)**, **sorting**, and **declarative row/column ordering and color overrides**.
3. Adding a new datacut must be purely declarative via template configuration without rewriting UI chrome or toolbar controls.

---

## 2. Core Invariants & Rules

1. **The Engine Owns Every Number**: The card component never sums, subtracts, averages, or recalculates survey percentages or deltas. Deltas ($\Delta$) and margins come exclusively from engine payload fields (`delta`, `focal_margin_pp`, `net_score`).
2. **NULL is Not Zero**: Missing, failed, unpolled, or non-contender cells render as em-dash (`—`) accompanied by a hoverable/subline reason (e.g. `Not asked in this round`, `Calculation failed`).
3. **Strict Percentage Formatting (`formatPercent`)**:
   - Every percentage displays with a `%` suffix.
   - If $|v| \ge 2.0$, round to whole number (`42%`, `−3%`).
   - If $|v| < 2.0$, display two decimals (`1.50%`, `0.00%`).
   - Seat counts are integers without `%`.
4. **Display Controls Never Trigger Network Requests**: Transpose, Show preset, Density, Format rule, Sort, and Lens/Measure switches operate strictly in-memory on the received `CardResult`.
5. **Round Labels are Never Bare**: Short labels (e.g. `R1`, `R2`) appear only under cycle/series group headers; all delta titles, tooltips, and summaries use full series-qualified base names (`2027 VS CAPI R2`).

---

## 3. Approaches Considered & Selected Architecture

| Approach | Structure | Pros | Cons | Verdict |
|---|---|---|---|---|
| **Approach 1: Composable Shell + Modular Body Adapters** | Universal `<CardChrome>` container + 4 specialized body adapters (`CompositeGridBody`, `RankedListBody`, `TransitionMatrixBody`, `BattlegroundSummaryBody`). | • 100% reusable toolbar, popovers, and formatting.<br>• Native UX tailored to each mathematical family.<br>• Adding new cuts takes ~10 lines of YAML. | Requires clean adapter boundary. | **Selected (User Approved)** |
| **Approach 2: Monolithic Single Table Grid** | Coerces every engine payload into one massive TanStack Table grid. | Single renderer component. | Forces rankings into sparse empty tables; destroys the visual impact of transition flows and flip buckets. | Rejected |
| **Approach 3: Independent Standalone Cards** | 5 completely isolated cards built independently. | Total isolation per card. | 70% duplicated Mantine popover & toolbar code; high risk of UI drift and token fragmentation. | Rejected |

---

## 4. Reusable Code & Existing Assets in `matbodh-dashboard`

The new architecture directly builds upon and reuses existing verified modules:

| Existing Asset | Path | Reuse Scope in Universal Card |
|---|---|---|
| **Design Tokens & Theme** | `web/src/theme.ts` | Token constants (`tokens.font`, `tokens.radius`), Mantine theme, CSS variables (`--mb-text`, `--mb-primary`, `--mb-gain`, `--mb-loss`). |
| **Percentage & Delta Formatters** | `web/src/cells/format.ts` | `formatPercent`, `formatValue`, `formatDelta`, `formatTrendPipes`, `FLAG_INFO`, `nullReason`. |
| **Composite Cell Frame & Pieces** | `web/src/cells/pieces.tsx` | `CellFrame`, `Dash`, `Delta`, `Flags`. |
| **Sparkline Engine** | `web/src/cells/Sparkline.tsx` | Inline SVG sparklines with cycle breaks for $>4$ rounds. |
| **Merged Seats Cell** | `web/src/cells/SeatsCell.tsx` | Specialized cell for composite AC $\cdot$ PC seat counts and seat deltas. |
| **Conditional Formatting Engine** | `web/src/table/formatRules.ts` | `FormatRule`, `cellStyle` (heat, diverging, none with column/row/table scopes), `legend`. |
| **Grid Data Model & Transpose** | `web/src/table/grid.ts` | `CellGrid`, `Header`, `GridCell`, `transpose`, `build`. |
| **Toolbar Popover Pattern** | `web/src/cards/CardToolbar.tsx` | `PopoverChip` primitive with Mantine `Popover`, SegmentedControl styling, Sort menu. |
| **Method Drawer & Coverage** | `web/src/cards/MethodDrawer.tsx`, `coverage.ts` | Contract inspection drawer and coverage legend. |

---

## 5. Architectural Specification

### 5.1 Component Hierarchy

```
<UniversalCard template={template} ctx={ctx}>
  │
  ├── <CardChrome>
  │     ├── Header: Title + Question Selector + Subtitle (Anchor · Δ vs Compare · Trend)
  │     │
  │     ├── <CardToolbar>
  │     │     ├── [Lens: Support % (Row) ▾]     <-- (View/Lenses Popover, Slices only)
  │     │     ├── [Cell: Both + trend ▾]        <-- (Show Preset Popover)
  │     │     ├── [Density: Standard ▾]         <-- (Compact / Standard / Detailed)
  │     │     ├── [Format: Diverging (Δ) ▾]     <-- (Diverging / Heatmap + Scope Popover)
  │     │     ├── [⇄ Transpose]                 <-- (Client-side Row <-> Col swap)
  │     │     ├── [Sort: High to Low ▾]         <-- (Column Sort Popover)
  │     │     ├── [Filter: Zone (Jat Belt) ▾]   <-- (Promoted Slicer or Attribute Filter)
  │     │     └── [⋯]                           <-- (Menu: Method Drawer, CSV, Refresh)
  │     │
  │     ├── <CardBodySlot>                      <-- (Selects adapter based on template.body_adapter)
  │     │     ├── <CompositeGridBody />         <-- Standard TanStack table (Slices, Scoreboard, Opinion)
  │     │     ├── <RankedListBody />            <-- Top-K ranked lists (Castes per AC, Seat metrics)
  │     │     ├── <TransitionMatrixBody />      <-- Origin x Destination voter flow matrix
  │     │     └── <BattlegroundSummaryBody />   <-- Seat flip buckets & margin distributions
  │     │
  │     └── <CardFooter>
  │           ├── Coverage note (e.g. "403 / 403 ACs matched")
  │           ├── Not asked / Excluded notes
  │           ├── Format scale legend (e.g. "Diverging on Δ (scaled within each column)")
  │           └── "How this was calculated →" (Opens MethodDrawer)
  │
  └── <InvestigationDrawer />                  <-- (Slide-over drawer for "Investigate seats ->")
```

---

### 5.2 The 4 Body Adapters & Data Models

#### 1. `CompositeGridBody`
* **Contracts**: `distribution.json`, `distribution_across_rounds.json`, `distribution_caste.json`, `distribution_gd.json`, `pulse.party_scoreboard`, `pulse.leaders`.
* **Data Model**: `CellGrid` (rows, columns, cells).
* **Multi-Measure Payload**: Each `SeriesCell` in the backend response contains:
  ```ts
  interface SeriesCell {
    series: string;
    label: string;
    colour: string | null;
    cell: Cell | null;                            // Default lens (support_share)
    lenses?: Record<string, Cell | null>;         // e.g. contribution_share, size_of_impact_pp, composition_share
  }
  ```
  Switching lenses updates `GridCell.cell` from `lenses[activeLens]` in-memory with zero network overhead.

#### 2. `RankedListBody`
* **Contracts**: `ranking.demographic.example.json` (Top 3 castes per AC), `distribution_seat_rank.json` (Ranked seats by net score or support share), `distribution_seat_rank_comp.json` (Ranked by Shakti gap), `distribution_seat_rank_comp_complex.json` (Ranked by PM satisfaction change).
* **Measures and Kinds Supported**:
  - **Standalone Measures**:
    - `net_score` (Net approval in pp: Positive − Negative)
    - `positive_share` (Gross favourable / satisfied %)
    - `negative_share` (Gross unfavourable / dissatisfied %)
    - `support_share` (Party support in seat or demographic group)
  - **Comparative Deltas & Kinds** (via `comparison_id`):
    - `kind: difference` (Target minus Reference: e.g. change in positive share or vote share swing)
    - `kind: shakti` (Leader favourable share minus party support share for a focal party)
* **Payload Structure (`CardResult.ranked_list`)**:
  ```ts
  interface RankedItem {
    rank: number;
    label: string;
    value: number | null;
    delta: number | null;
    measure: "net_score" | "positive_share" | "negative_share" | "support_share";
    kind?: "difference" | "shakti";
    secondary?: string | null;  // e.g. "58% sat · 34% dis" or "Party 42% vs Leader 54%"
    tags?: string[];            // e.g. Zone, District, Category
  }
  interface RankedPartition { partition_key: string; partition_label: string; items: RankedItem[]; }
  interface RankedListResult {
    measure: string;
    kind?: string;
    polarity: "highest_first" | "lowest_first";
    partitions: RankedPartition[];
    total_ranked: number;
  }
  ```
* **Visual Presentation & Controls**:
  - **Rank Metric Selector**: `[ Ranked by: Net Score ▾ ]` switchable to `Positive Share`, `Negative Share`, `Δ Change`, or `Shakti Gap`.
  - Compact cards or sortable lists showing rank badges (`#1`, `#2`, `#3`), party colors, percentage progress meters, signed deltas, and dual-share secondary text.

#### 3. `TransitionMatrixBody`
* **Contracts**: `distribution_transition.json`, `distribution_transition_mcap.json`, `relationship.answers.example.json`.
* **Payload Structure (`CardResult.transition`)**:
  ```ts
  interface TransitionCell { origin: string; destination: string; origin_share: number; destination_share: number; joint_share: number; }
  interface TransitionMatrixResult { origins: string[]; destinations: string[]; matrix: Record<string, Record<string, TransitionCell>>; }
  ```
* **Lenses**:
  - `Flow Out (Origin %)`: *"Where did 2022 voters go?"* (Diagonal = voter retention %; off-diagonal = leakage).
  - `Flow In (Destination %)`: *"Where did current votes come from?"* (Source composition).
  - `Electorate % (Joint Share)`: Share of total electorate transitioning.
* **Visual Polish**: Retention diagonal cells highlighted with a subtle primary border. Non-voters (`Did Not Vote`, `Do Not Remember`) styled with distinct dashed boundaries.

#### 4. `BattlegroundSummaryBody` & Investigation Drawer
* **Contracts**: `benchmark.election.example.json`, `benchmark.rounds.example.json`, `distribution_rounds_benchmark.json`.
* **Payload Structure (`CardResult.battleground`)**:
  ```ts
  interface BattlegroundResult {
    flips: { winning_both: number; gain: number; loss: number; losing_both: number };
    margin_buckets: { bucket: string; count: number; seat_ids: string[] }[];
    seats: { seat_id: string; winner: string; margin_pp: number; flip: string }[];
  }
  ```
* **Interaction**: Clicking **"Investigate these 67 gained seats $\rightarrow$"** opens the `<InvestigationDrawer>` slide-over panel.

---

### 5.3 The Unified Measure and Comparison Kind System

The card component standardizes the full inventory of analytical measures and comparison kinds established in the engine documentation (`usage.md` and `datacut-families.yaml`):

#### 1. Measure Inventory by Datacut Family
| Family | Available Measures | Unit | Meaning |
|---|---|---|---|
| **Electoral Slices** | `support_share`<br>`contribution_share`<br>`size_of_impact_pp`<br>`composition_share`<br>`joint_share` | `%`<br>`%`<br>`pp`<br>`%`<br>`%` | • How the group votes (Row %)<br>• Party's voter base composition (Col %)<br>• Weighted impact on election (`share × comp / 100`)<br>• Demographic weight in population<br>• Joint probability in electorate |
| **Public Opinion & Ratings** | `net_score`<br>`positive_share`<br>`negative_share` | `pp`<br>`%`<br>`%` | • Net approval (`positive − negative`)<br>• Gross favourable / satisfied rating<br>• Gross unfavourable / dissatisfied rating |
| **Seat Benchmarks** | `vote_share`<br>`seats_ac`<br>`seats_pc`<br>`focal_margin_pp` | `%`<br>`seats`<br>`seats`<br>`pp` | • Aggregate vote share in benchmark<br>• Assembly seats won / leading<br>• Parliamentary seats won / leading<br>• Margin over strongest competitor |
| **Rankings (Seat & Demographic)** | `support_share`<br>`net_score`<br>`positive_share`<br>`negative_share`<br>`comparison_delta`<br>`shakti` | `%`<br>`pp`<br>`%`<br>`%`<br>`pp`<br>`pp` | • Party support in AC or caste<br>• Leader net satisfaction in AC<br>• Leader positive rating in AC<br>• Leader negative rating in AC<br>• Shift / swing between rounds<br>• Leader pull over party |

#### 2. Comparison `kind` Types
* **`kind: difference`**:
  - Ordinary target minus reference arithmetic ($\Delta$).
  - Evaluated on `support_share` (vote swing), `net_score` (net satisfaction shift), `positive_share` (gross approval movement), or seat counts.
* **`kind: shakti`**:
  - Favourable approval share minus party support share (`positive_share(Leader) − support_share(Party)`).
  - Measures the leader's net pull over the party baseline in each seat or demographic group.

#### 3. UX Exposure of Measures & Kinds in Cards
* **Sliced Distribution Cards**:
  The `[ Lens ▾ ]` popover allows switching between `Support Share`, `Contribution Share`, `Net Impact`, and `Composition Share`.
* **Public Opinion Cards (`pulse.leaders`)**:
  The `[ Lens ▾ ]` popover allows switching between:
  - ◉ **Net Score** (default, $\text{pp}$, with signed $\Delta$ in comparison mode)
  - ○ **Gross Satisfaction** (`positive_share`, $\%$, with $\Delta$)
  - ○ **Gross Dissatisfaction** (`negative_share`, $\%$, with $\Delta$)
  - The cell subline continuously displays the dual view: `{positive}% sat · {negative}% dis`.
* **Ranking Cards (`RankedListBody`)**:
  A dedicated toolbar selector `[ Ranked by: {Measure} ▾ ]` enables ranking by:
  - **Standalone Levels**: `Net Score`, `Positive Share`, `Negative Share`, `Party Vote Share`.
  - **Deltas (`kind: difference`)**: `Change in Net Score`, `Change in Positive %`, `Party Vote Swing`.
  - **Shakti Gap (`kind: shakti`)**: `Leader Shakti Differential`.

---

### 5.4 Investigation Slide-Over Drawer (`InvestigationDrawer.tsx`)

To ensure the user experience is smooth and non-disruptive (Option B):
1. **Slide-Over Panel (Right side, width 540px desktop)**:
   - Uses Mantine `Drawer` with backdrop blur and smooth cubic-bezier transition.
   - The underlying page remains visible and interactive; scroll position is preserved.
2. **Drawer Header**:
   - Clear context: `"Investigating: 67 Gained Seats"`
   - Subtitle: `"Seats won by NDA in 2027 VS CAPI R2 that were lost in R1"`
   - Action bar: `[ Copy seat list ] [ Export CSV ] [ ✕ Close ]`
3. **Drawer Content Sections**:
   - **Section 1: Cohort Overview**: Total seats, aggregate vote share in these seats, average winning margin.
   - **Section 2: Demographic Drivers**: Mini horizontal bar breakdown of vote share across key castes in these specific seats.
   - **Section 3: Candidate vs. Party Impact**: Split-ticket metric showing whether candidate pull exceeded party baseline.
   - **Section 4: Complete Seat Roster**: Scrollable table of the 67 seats with individual margins and flip history.
4. **Escape Hatches & Accessibility**: Keyboard `Esc`, click outside backdrop, visible close button, and focus trap with accessible ARIA labeling.

---

### 5.5 Hierarchical Attribute Filtering & Slicer Promotion

1. **Promoted Slicers**:
   - When a datacut declares multiple dimensions (e.g. `slices: [party_zone, category, caste]`), the top-level spatial dimension (`party_zone`) automatically promotes to a prominent Slicer chip in the toolbar: `[ Zone: All Zones ▾ ]`.
   - Selecting a zone instantly filters the displayed table.
2. **Seat-Level Filtering**:
   - On seat-level cards (AC rankings, seat battlegrounds), the `+ Filter ▾` popover filters rows in-memory by master attributes (SC/ST reserved, margin buckets).
   - On demographic aggregate cards where rows are categories (`GEN`, `OBC`), selecting a filter that was not pre-aggregated triggers a re-query via `CardRunService` for that specific cohort.

---

### 5.6 Conditional Formatting Engine (Google Sheets Style)

* **Toolbar Control**: `PopoverChip` with `Format: Diverging (Δ) ▾`.
* **Modes**:
  1. `Diverging on Δ / Net Score`: Negative red (`#bf3333`) $\leftrightarrow$ Neutral (`#6b7380`) $\leftrightarrow$ Positive green (`#0d804d`).
  2. `Heatmap on Value`: Sequential white to soft slate-blue (`rgba(38, 99, 235, alpha)` from `#2663eb`) scaled $0\%$ to maximum value in scope.
  3. `None`: Clean monochrome display.
* **Scopes**:
  - `Within each column` (Default): Compares parties within the same caste or seats within the same district.
  - `Within each row`: Compares demographic groups for a single party.
  - `Across all columns`: Table-wide heatmap.
* **Accessibility**: Colors are strictly supplementary. Value arrows (`▲`/`▼`) and minus sign (`−`) are always rendered.

---

### 5.7 Declarative Presentation Rules & Color Overrides

* **API Integration**: Endpoint `GET /api/presentation/{state}` serves state-specific formatting and ordering rules from `config/presentation/`.
* **Rules Consumed by Cards**:
  - `rowOrder`: e.g. `category: ["GEN", "OBC", "SC", "ST"]`.
  - `columnOrder`: e.g. `party: ["NDA", "SP+", "BSP", "Other", "Undecided", "NOTA"]`.
  - `pinLast`: Arrays of keys pinned to the end (e.g. `["Other", "Undecided", "NOTA"]`).
  - `entityColors`: Direct hex map for party branding (e.g. `NDA: #ff9933`, `SP+: #e11d48`, `BSP: #1e40af`, `INC: #0ea5e9`).
  - `unknown`: Policy for newly discovered parties or categories (`append_alpha` or `append_natural`).

---

## 6. Declarative Template Configuration (Extensibility)

Adding a new datacut to the dashboard requires only adding a template entry in `config/templates/`:

```yaml
templates:
  - id: coalitions.caste_support
    section: coalitions
    title: Support by caste cascade
    operation: distribution
    body_adapter: composite_grid      # composite_grid | ranked_list | transition_matrix | battleground_summary
    questions: [vs_voting_intention]
    slices: [party_zone, category, caste]
    lenses:
      default: support_share
      options: [support_share, contribution_share, size_of_impact_pp, composition_share]
    requires:
      min_level: state
    cell: [value, delta, trend, base]
    density: standard
    presentation:
      row_field: category
      col_field: party
      slicer: party_zone
```

Zero React or TypeScript changes are required to add this datacut. The universal `<CardChrome>` and `<CompositeGridBody>` automatically interpret the payload and wire up the View/Lenses, Slicers, Formatting, Filters, and Ordering rules.

---

## 7. Implementation Breakdown for the Plan

1. **Backend Payload Enrichment (`matbodh_dashboard/normalise/`)**:
   - `rows.py`: Extract `contribution_share`, `size_of_impact_pp`, and `composition_share` in `from_analysis()`.
   - `cells.py`: Attach `lenses` dictionary to `SeriesCell`.
   - `api/app.py`: Add `GET /presentation/{state}` endpoint.
2. **Frontend Card Chrome & Toolbar (`web/src/cards/`)**:
   - Add `View/Lenses` popover chip to `CardToolbar.tsx`.
   - Add `CardFilterBar.tsx` for promoted slicers and seat filters.
   - Create `InvestigationDrawer.tsx` for slide-over seat cohort analysis.
3. **Data Grid & Presentation Integration (`web/src/table/`)**:
   - Update `gridFor()` in `grid.ts` to respect active lens.
   - Implement custom row/column ordering and pinning using presentation rules.
4. **Body Adapters (`web/src/cards/body/`)**:
   - `CompositeGridBody.tsx` (wrapped table).
   - `RankedListBody.tsx` (top-K castes and seats).
   - `TransitionMatrixBody.tsx` (voter flows and retention diagonal).
   - `BattlegroundSummaryBody.tsx` (flip tiles and margin buckets).
5. **Testing Suite**:
   - Vitest tests for multi-measure lens switching.
   - Vitest tests for row/col ordering, pinning, and brand colors.
   - Vitest tests for drawer opening and closing on "Investigate seats".
   - Playwright E2E journey verifying interactive filters, lenses, and formatting.
