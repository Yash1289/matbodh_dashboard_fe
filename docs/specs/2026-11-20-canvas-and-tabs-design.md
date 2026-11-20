# Canvas and tabs (sub-project 6b): design

Status: approved 2026-11-20; built on branch `feat/canvas-and-tabs` (plan `docs/plans/2026-11-20-canvas-and-tabs.md`), with the deviations listed in `docs/open-items.md` section 2.1c. Roadmap row 6b in `docs/open-items.md`. Builds on the card visual design (`2026-11-20-card-visual-design.md`) and the card configure work (`2026-11-19-card-configure-design.md`).

## 1. Intent

The Cards page is one column of cards with no placement. The owner's flow (memory: canvas vision, 2026-11-19) is a blank canvas where an analyst adds cards, places and resizes them, and groups them into tabs, like sheets in a spreadsheet. Each analyst builds their own views, so the arrangement is saved work, not throwaway.

## 2. Goals, non-goals, anti-goals

Goals
- A blank canvas per tab. Add a card, drag it, resize it, remove it, copy it.
- Tabs: add, rename, reorder, delete. Each tab has its own cards and layout.
- The arrangement is saved per state in this browser and survives a reload.
- Every action works from the keyboard.

Non-goals (not in 6b)
- The context step and the database (6c). Tabs all read the one current context.
- Sharing, permissions, saving under a login (access-control phase).
- Free pixel placement or overlapping cards. Undo and redo. Dragging tabs. Dragging cards between tabs.
- Changing what a card computes or how it is configured.

Anti-goals
- A layout that hides a table behind another table.
- Dragging that is the only way to do something.
- Any layout state sent to the engine. Position and size are display state only.

## 3. Approaches

1. **A grid library (chosen by the owner).** `react-grid-layout` provides drag, resize, push-away and compaction on a 12-column grid. Trade-off: one dependency, weak built-in keyboard support (we add it).
2. Own CSS grid and pointer events. No dependency, but drag, resize and collision logic is ours to write and test. Rejected as more code for the same result.
3. Size menu only, no dragging. Cheapest, but not the "place and resize" the owner described. Rejected.

## 4. Design

### 4.1 Grid
- 12 columns, snapped, vertical compaction on (cards move up to close gaps), no overlap, no free placement.
- A card's width in columns decides its size class. The builder maps 12 columns at the page width to the card's pixel width; the existing container-query classes (narrow below 420px, medium 420 to 719px, wide from 720px) keep working unchanged because they read the card's own width.
- Card height is a number of grid rows. The card body scrolls inside the cell when its content is taller. New cards get a default size by family (builder's call, from the family's usual content). A "Fit to content" action sets the height from the measured content height.
- Below a narrow page width (about 640px) the grid collapses to one column in reading order (top to bottom, then left to right), with no drag or resize.

### 4.2 Card controls
- Drag by a handle in the card header; resize by the bottom-right corner.
- Keyboard and screen-reader route (library does not provide it): the card menu has Move (left, right, up, down by one step), Size (Small 4 columns, Medium 6, Wide 8, Full 12) and Fit to content. Results are announced ("Moved to column 5, row 2").
- The card menu also keeps Configure, Copy card, Copy config and Remove (today's buttons above each card), plus **Move to tab**. (Move to tab is a small extra; drop it if it adds risk.)
- A copied card is placed directly below the original at the same width.

### 4.3 Tabs
- A tab bar under the context bar. A new workspace has one empty tab, "Tab 1". A plus control adds a tab. Rename in place (menu or double-click). Reorder with Move left and Move right in the tab menu. Delete from the tab menu; a tab with cards asks first and says how many cards go with it.
- The last tab cannot be deleted. The active tab is remembered.
- An empty tab shows a prompt with the Add card control.

### 4.4 Adding cards
- Add card keeps today's menu (families and library cards). A new card is placed at the first free spot that fits its default size, scanning top to bottom, left to right, then opens Configure as it does today.
- Library cards no longer render in a separate list; they appear only when an analyst adds one, as their own copy (as the menu already does).

### 4.5 Storage
- One record per state, key `mb.workspace.<state>`, JSON: `{ version: 1, activeTab, tabs: [{ id, name, items: [{ cardId, x, y, w, h }] }] }`. Card configs stay in the existing card store (`mb.cards.<state>`); the workspace only references them by id, so 6c can move both to the database unchanged.
- Migration: on first read, any stored card not placed anywhere is put in the first tab, one per row at full width, in stored order. A reference to a card that no longer exists is dropped on read.
- Storage can throw (private windows); memory still works, as the card store does. Another browser tab's change is picked up through the `storage` event.
- Layout changes write once when a drag or resize ends, not on every pixel.

## 5. Constraints
- Dashboard repo rules: display state never goes into engine requests; the browser computes no numbers; colours and sizes come from `web/src/theme.ts` tokens (the hex-colour test applies).
- The Cards page, card components, Configure panel and cohort flow keep their behaviour; the existing 417 web tests stay green.
- Dependency: latest `react-grid-layout` 2.x if it supports React 18 and the features above, otherwise 1.5.x. The builder checks before installing.

## 6. Testing
- Unit (pure functions, no DOM): first-free-spot placement; migration of existing cards; dropping dangling references; add, rename, reorder, delete tab; move and size by keyboard step; copy placement; collapse order for the one-column layout.
- Component: tab bar actions and the delete confirmation; the card menu's Move, Size and Fit; announcements.
- Browser (Playwright, as the existing e2e): drag a card, resize a card, reload and see the layout kept; a narrow window shows one column. jsdom cannot judge drag, so this is the proof for dragging.

## 7. Left to the builder
- Default size per family and the row height in pixels.
- Exact breakpoint for the one-column layout.
- Menu wording and announcement text.
- Whether the card menu is one menu or the existing button row plus a menu, as long as every action is reachable by keyboard.
