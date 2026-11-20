# Canvas and Tabs (6b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-column Cards list with a tabbed, snapped 12-column canvas where analysts place, resize, copy, move and remove cards, saved per state in the browser.

**Architecture:** Pure layout functions (`web/src/canvas/layout.ts`) and a workspace store (`workspaceStore.ts`) that references cards by id and reconciles against the existing `cardStore`; a `Canvas` component built on `react-grid-layout`; a tab bar; a per-card toolbar with the keyboard route; `CardsPage` rewired to them. Card components, Configure and cohorts are untouched.

**Tech Stack:** React 18, Mantine 7, Vitest + Testing Library, Playwright (installed Chrome), `react-grid-layout`.

**Spec:** `docs/specs/2026-11-20-canvas-and-tabs-design.md`

## Global Constraints

- Work in `web/` of the dashboard repo, on a new branch `feat/canvas-and-tabs` cut from `main`. Commit explicit paths only. Never stage or commit `docs/specs/2026-11-08-dashboard-design.md`, `CLAUDE.md`, `uv.lock`, `.codegraph/` or `node_modules/`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Layout state is display state only: nothing from the workspace goes into an engine request, and the card store's stored config is not changed by moving or sizing.
- Colours and sizes come from `web/src/theme.ts` tokens; no hex outside the allow list in `theme.test.ts`.
- 12 columns, snapped, vertical compaction, no overlap, no free placement. Size presets: Small 4, Medium 6, Wide 8, Full 12 columns.
- Storage: key `mb.workspace.<state>`; value `{ version: 1, activeTab, tabs: [{ id, name, items: [{ cardId, x, y, w, h }] }] }`. Reads and writes are wrapped so a blocked or corrupt store never errors the page (memory fallback, as `cardStore.ts` does).
- One column, no drag or resize, below a page width of 640px (constant `NARROW_PAGE`, builder may adjust).
- Dependency: latest `react-grid-layout` 2.x if it supports React 18 and exposes the layout utilities used in Task 1 (`compact`, `moveElement` or equivalents); otherwise `1.5.x` with `@types/react-grid-layout`. Pin the exact version in `package.json` (the repo pins all versions).
- Existing suites stay green: `npm test` (417 web tests before this work, adjusted only where Task 6 says), `npm run typecheck`, `npm run build`.

## Review Focus

Input classes the spec implies but a happy-path build would miss. Each has its test in the task named.

1. Corrupt or foreign data in `mb.workspace.<state>` (not JSON, wrong shape, `version` 2): start a fresh workspace, never throw. Task 2.
2. Out-of-range or non-integer stored positions and sizes (`w: 40`, `x: -3`, `h: NaN`): clamp into the grid. Task 1.
3. Card ids in the workspace that the card store no longer has, and stored cards that no tab holds (another browser tab added or removed one): dropped or placed on the next read, once. Task 2.
4. Deleting the active tab, and deleting the last tab: the active tab moves to a neighbour; the last tab cannot be deleted. Task 2.
5. Switching state in the context bar: each state shows its own workspace, and a card from one state never appears in another. Task 6.

---

### Task 1: Dependency and pure layout functions

**Files:**
- Modify: `web/package.json` (and lockfile)
- Create: `web/src/canvas/layout.ts`
- Test: `web/src/canvas/layout.test.ts`

**Interfaces:**
- Produces (all exported from `layout.ts`):
  - `COLUMNS = 12`, `SIZE_PRESETS = { small: 4, medium: 6, wide: 8, full: 12 } as const`, `type SizePreset = keyof typeof SIZE_PRESETS`, `type Direction = "left" | "right" | "up" | "down"`.
  - `interface Item { cardId: string; x: number; y: number; w: number; h: number }`.
  - `defaultSize(family: string): { w: number; h: number }` (grid columns and rows; one table-heavy default, one smaller default for grid and ranking families; builder's call on the numbers).
  - `normalise(item: Item): Item` clamps to integers: `w` 1..12, `x` 0..12-`w`, `y` >= 0, `h` >= 1; non-finite values fall back to the default size and position 0.
  - `firstFreeSpot(items: Item[], size: { w: number; h: number }): { x: number; y: number }` scans rows top to bottom, columns left to right.
  - `moveBy(items: Item[], cardId: string, dir: Direction): Item[]` moves one column or one row and settles collisions with the library's own rules.
  - `resizeTo(items: Item[], cardId: string, preset: SizePreset): Item[]` sets the width, keeps `x` inside the grid, settles collisions.
  - `fitHeight(items: Item[], cardId: string, rows: number): Item[]`.
  - `settle(items: Item[]): Item[]` vertical compaction; a thin wrapper over the library's `compact`, so keyboard actions and drag follow the same rules.
  - `readingOrder(items: Item[]): Item[]` sorted by `y` then `x` (used for the one-column layout).

- [ ] **Step 1: Create the branch and add the dependency.** `git checkout -b feat/canvas-and-tabs main`. Run `npm view react-grid-layout version peerDependencies` and check the latest 2.x lists React 18 and exports the layout utilities; if not, use 1.5.x plus its types. `npm install --save-exact react-grid-layout`. Expected: installs, `npm run typecheck` still passes.
- [ ] **Step 2: Write the failing tests** in `layout.test.ts`, with these names and assertions:
  - `firstFreeSpot puts the first card at 0,0` and `skips occupied cells: with a 6-wide card at 0,0 a 6-wide card goes to x=6,y=0, and a 12-wide card goes to y=(first row below)`.
  - `normalise clamps a 40-wide card to 12 and a negative x to 0, and replaces NaN with the default`.
  - `moveBy right on a card at x=6,w=6 stays at x=6 (grid edge)`; `moveBy down below an occupied cell pushes the other card, leaving no overlap`.
  - `resizeTo wide on a card at x=8 moves it left so x+w <= 12`.
  - `settle closes a gap above a card` and `no two items overlap after settle`.
  - `readingOrder sorts by row then column`.
- [ ] **Step 3: Run to confirm failure.** `cd web && npx vitest run src/canvas/layout.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 4: Implement `layout.ts`** to the signatures above, delegating compaction and collision to the library's utilities; only `firstFreeSpot`, `normalise` and `readingOrder` are ours.
- [ ] **Step 5: Run to confirm pass.** Same command. Expected: PASS. Also `npm run typecheck`.
- [ ] **Step 6: Commit** `web/package.json`, the lockfile, `web/src/canvas/layout.ts`, `web/src/canvas/layout.test.ts` with message `feat(canvas): grid dependency and pure layout functions`.

---

### Task 2: Workspace store

**Files:**
- Create: `web/src/canvas/workspaceStore.ts`
- Test: `web/src/canvas/workspaceStore.test.ts`

**Interfaces:**
- Consumes: `cardStore`, `useStoredCards`, `StoredCard` from `web/src/configure/cardStore.ts`; `Item`, `defaultSize`, `firstFreeSpot`, `normalise`, `settle` from Task 1.
- Produces (exported from `workspaceStore.ts`):
  - `interface Tab { id: string; name: string; items: Item[] }`, `interface Workspace { version: 1; activeTab: string; tabs: Tab[] }`.
  - `reconcile(raw: unknown, cards: StoredCard[]): Workspace` pure: invalid `raw` gives a fresh workspace with one tab "Tab 1"; every item is normalised; items whose `cardId` is not in `cards` are dropped; a card id appearing twice keeps the first; cards no tab holds go into the first tab, one per row at full width at `defaultSize` height, in stored order; `activeTab` falls back to the first tab if it does not exist.
  - `useWorkspace(state: string | null): Workspace` (via `useSyncExternalStore`, stable snapshot per write, reconciled with `useStoredCards`).
  - `workspaceStore` with, all taking `state` first: `addCard(config: CardConfigJson, tabId?: string): StoredCard` (cardStore.add then place at `firstFreeSpot` with `defaultSize(config.family)` in the given or active tab); `copyCard(cardId): StoredCard | null` (placed directly below the original, same width); `removeCard(cardId)`; `setItems(tabId, items)`; `moveCardToTab(cardId, tabId)` (placed at first free spot of the target); `addTab(): Tab` (named "Tab n", becomes active); `renameTab(tabId, name)` (trimmed; blank is ignored); `moveTab(tabId, -1 | 1)`; `deleteTab(tabId): number` (returns how many cards were removed with it; throws if it is the last tab); `setActiveTab(tabId)`.
  - `_dropWorkspaceMemory(): void` for tests.

- [ ] **Step 1: Write the failing tests** in `workspaceStore.test.ts` (same set-up as `cardStore.test.ts`: `localStorage.clear()` and drop memory after each):
  - reconcile: `fresh workspace for null, a string, an array and version 2` (Review Focus 1); `drops items whose card is gone`; `places an unplaced card in the first tab at full width, in stored order`; `keeps the first of a duplicated card id`; `clamps stored out-of-range items`; `active tab falls back to the first tab`.
  - store: `addCard places the card at the first free spot in the active tab and stores its config in cardStore`; `copyCard puts the copy under the original at the same width`; `removeCard drops the card from its tab`; `deleteTab returns the number of cards removed and removes them from cardStore`; `deleting the active tab activates a neighbour`; `the last tab cannot be deleted` (Review Focus 4); `moveTab swaps order and keeps the active tab`; `renameTab ignores a blank name`; `moveCardToTab removes it from the old tab and places it in the new one`.
  - persistence: `survives a reload` (drop memory, read again); `falls back to memory when localStorage throws`; `a storage event from another browser tab refreshes the workspace` (dispatch `StorageEvent` for `mb.workspace.<state>`), and `a card added by another browser tab appears in the first tab` (Review Focus 3).
- [ ] **Step 2: Run to confirm failure.** `cd web && npx vitest run src/canvas/workspaceStore.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `workspaceStore.ts`**, following the shape of `cardStore.ts` (memory map, localStorage with try/catch, listener set, `storage` event for keys starting `mb.workspace.` and also `mb.cards.` so card changes refresh the reconciled view). Each operation reads the reconciled workspace, changes it, and writes the result.
- [ ] **Step 4: Run to confirm pass.** Same command, then `npm test` for the whole suite. Expected: PASS.
- [ ] **Step 5: Commit** `web/src/canvas/workspaceStore.ts` and its test with `feat(canvas): workspace store with tabs, placement and reconcile`.

---

### Task 3: Tab bar

**Files:**
- Create: `web/src/canvas/TabBar.tsx`
- Test: `web/src/canvas/TabBar.test.tsx`

**Interfaces:**
- Consumes: `Workspace`, `workspaceStore` (Task 2).
- Produces: `TabBar({ state, workspace }: { state: string; workspace: Workspace })`, rendering Mantine `Tabs` (role `tablist`), a "New tab" button, and a per-tab menu (Rename, Move left, Move right, Delete).

- [ ] **Step 1: Write the failing tests** with Testing Library and `userEvent`:
  - `shows the tabs and marks the active one`; `New tab adds and activates a tab`; `Rename edits the name in place and Enter saves, Escape cancels`; `Move right changes the order`; `Delete on an empty tab removes it without a prompt`; `Delete on a tab with 2 cards asks first and names the count ("2 cards"), and Cancel keeps it`; `Delete is disabled on the last tab`; `arrow keys move between tabs` (Mantine's own behaviour, asserted).
- [ ] **Step 2: Run to confirm failure.** `npx vitest run src/canvas/TabBar.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement `TabBar.tsx`** with Mantine components and `tokens`; the delete confirmation is a Mantine `Modal` (as `CardsPage` already uses), not `window.confirm`.
- [ ] **Step 4: Run to confirm pass**, then `npm run typecheck`.
- [ ] **Step 5: Commit** `web/src/canvas/TabBar.tsx` and its test with `feat(canvas): tab bar`.

---

### Task 4: Canvas grid and card cell

**Files:**
- Create: `web/src/canvas/Canvas.tsx`, `web/src/canvas/CanvasCell.tsx`, `web/src/canvas/canvas.module.css`
- Test: `web/src/canvas/Canvas.test.tsx`

**Interfaces:**
- Consumes: `Item`, `settle`, `readingOrder`, `moveBy`, `resizeTo`, `fitHeight` (Task 1); `Tab`, `workspaceStore.setItems` (Task 2).
- Produces:
  - `Canvas({ state, tab, renderCard, onConfigure }: { state: string; tab: Tab; renderCard(cardId: string): ReactNode; onConfigure(cardId: string): void })`: measures its own width (Mantine `useElementSize`); at or above `NARROW_PAGE` renders the library grid (12 columns, row height and margin from `tokens.layout.gap`, drag only by the `.canvas-handle` class, resize from the bottom-right corner, compaction vertical) and writes `setItems` once when a drag or resize ends; below it renders one column in `readingOrder` with no drag or resize.
  - `CanvasCell({ cardId, ... })`: a slim toolbar row (drag handle labelled "Drag card", card menu from Task 5) above the card body; the body fills the cell and scrolls vertically when its content is taller.
  - Constant `NARROW_PAGE = 640`.

- [ ] **Step 1: Write the failing tests** (jsdom cannot judge dragging; these cover rendering and layout choice; set the measured width by stubbing `ResizeObserver`):
  - `renders one cell per item with the card's own content`; `an empty tab renders nothing but the empty prompt slot` (prompt itself is Task 6); `at 900px wide cells carry the grid and a drag handle`; `at 500px wide cells are one column in reading order and have no handle`; `a layout change callback writes setItems once` (invoke the library's change handler directly with a new layout and assert one write with normalised items).
- [ ] **Step 2: Run to confirm failure.** `npx vitest run src/canvas/Canvas.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `Canvas`, `CanvasCell` and the CSS module (import the library's stylesheet; style the handle, the placeholder and the resize corner with `var(--mb-*)` tokens and `tokens.elevation.lift`). Card height is the item's `h` rows; the cell body is `overflow-y: auto`. The drag handle is the slim toolbar row, so none of the four card components change.
- [ ] **Step 4: Run to confirm pass**, then `npm run typecheck` and `npx vitest run src/theme.test.ts` (hex rule).
- [ ] **Step 5: Commit** the three new files and the test with `feat(canvas): snapped grid and card cell`.

---

### Task 5: Card menu with keyboard route

**Files:**
- Create: `web/src/canvas/CardMenu.tsx`
- Modify: `web/src/canvas/CanvasCell.tsx` (mount the menu)
- Test: `web/src/canvas/CardMenu.test.tsx`

**Interfaces:**
- Consumes: `moveBy`, `resizeTo`, `fitHeight`, `SIZE_PRESETS`, `Direction` (Task 1); `workspaceStore` (Task 2); `copyConfigText`, `cardStore` (existing).
- Produces: `CardMenu({ state, tab, cardId, tabs, onConfigure, measureRows }: ...)`, a Mantine `Menu` ("Card actions") with: Configure, Copy card, Copy config, Move (Left, Right, Up, Down), Size (Small, Medium, Wide, Full), Fit to content, Move to tab (one entry per other tab; absent with one tab), Remove. A visually hidden `role="status"` live region announces each result, for example "Moved to column 5, row 2" and "Size set to Wide, 8 columns". `measureRows(): number` returns the cell body's content height in grid rows (used by Fit to content).

- [ ] **Step 1: Write the failing tests:**
  - `every action is a menu item reachable by keyboard` (open with Enter, arrow down, Enter).
  - `Move right changes the stored x by one and announces the new column and row`; `Move left at the edge changes nothing and says so`.
  - `Size Wide stores w=8 and announces it`; `Fit to content stores h from measureRows`.
  - `Copy card adds a second cell under the original`; `Move to tab moves the card and the menu hides the current tab`; `Remove removes the card`; `Configure calls onConfigure with the card id`.
  - `Copy config writes the existing YAML-list text to the clipboard, and a blocked clipboard does not throw` (behaviour carried over from `CardsPage`).
- [ ] **Step 2: Run to confirm failure.** `npx vitest run src/canvas/CardMenu.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement `CardMenu.tsx`**; move the copy-config and clipboard logic out of `CardsPage.StoredCardView` into it (Task 6 deletes the original). Mount it in `CanvasCell`.
- [ ] **Step 4: Run to confirm pass**, then the whole `npm test`.
- [ ] **Step 5: Commit** `CardMenu.tsx`, `CanvasCell.tsx` and the test with `feat(canvas): card menu with keyboard move, size and fit`.

---

### Task 6: Wire the Cards page

**Files:**
- Modify: `web/src/pages/CardsPage.tsx`, `web/src/pages/CardsPage.test.tsx`

**Interfaces:**
- Consumes: `useWorkspace`, `workspaceStore` (Task 2), `TabBar` (Task 3), `Canvas` (Task 4); existing `renderCard`, `infoOfStored`, `ConfigurePanel`, `AddCardMenu`.
- Produces: `CardsPage` renders the page title and Add card, `TabBar`, then `Canvas` for the active tab; an empty active tab shows "This tab is empty. Add a card to start." with the Add card control; `StoredCardView` and the separate library list are removed; `onPickFamily` applying a new card calls `workspaceStore.addCard`; `onPickLibrary` calls `workspaceStore.addCard(configOfInfo(info))`.

- [ ] **Step 1: Update the existing tests first, then add new ones.** The library cards the tests stub through `stubCardApi` no longer render by themselves: in each affected test, seed stored cards with `workspaceStore.addCard(STATE, configOfInfo(libraryInfo))` (or `cardStore.add`, which reconcile will place) before rendering, keeping every assertion. Add:
  - `a new card from Add card lands in the active tab at the first free spot` ;
  - `an analyst's cards in two tabs show only the active tab's cards`;
  - `changing state shows that state's own workspace and none of the other's cards` (Review Focus 5);
  - `an empty tab shows the empty prompt and Add card`;
  - `cards stored before tabs existed appear in Tab 1` (migration);
  - `a library card appears only after it is added from the menu`.
- [ ] **Step 2: Run to confirm the new tests fail and note which old ones fail for the right reason.** `npx vitest run src/pages/CardsPage.test.tsx`.
- [ ] **Step 3: Rewire `CardsPage.tsx`** to the interfaces above; delete `StoredCardView` and the library `SimpleGrid`. Keep the loading skeleton and error states as they are.
- [ ] **Step 4: Run the whole suite and checks.** `npm test`, `npm run typecheck`, `npm run build`. Expected: all pass; the count is 417 plus the new tests.
- [ ] **Step 5: Commit** `web/src/pages/CardsPage.tsx` and `web/src/pages/CardsPage.test.tsx` with `feat(canvas): Cards page on the tabbed canvas`.

---

### Task 7: Browser test for drag, resize, reload and narrow

**Files:**
- Create: `web/e2e/canvas.spec.ts`

**Interfaces:**
- Consumes: the running app; fixtures as in `e2e/configure.spec.ts` (copy its `serve(page)` API stub rather than importing it, matching the other specs' style).

- [ ] **Step 1: Write the spec** with these tests, all against the built preview:
  - `drag a card to the right column and the layout survives a reload` (add two cards, drag the second's handle beside the first, reload, assert both cards' bounding boxes are side by side).
  - `resize a card from its corner snaps to the column grid` (assert the width is a multiple of one column plus gap, within 2px).
  - `Size and Move from the keyboard menu match the dragged result` (use the menu only, no mouse drag).
  - `a second tab keeps its own cards; deleting a tab with cards asks first`.
  - `at 500px wide the cards are one column and have no drag handle`.
- [ ] **Step 2: Run.** `cd web && npm run e2e`. Expected: the new tests pass along with the four existing e2e specs. Fix any real defect found in the earlier tasks with a failing unit test first.
- [ ] **Step 3: Commit** `web/e2e/canvas.spec.ts` with `test(canvas): browser checks for drag, resize, reload and narrow`.

---

### Task 8: Docs

**Files:**
- Modify: `docs/open-items.md`, `docs/specs/2026-11-20-canvas-and-tabs-design.md`, `docs/README.md` (only if it indexes specs or lists the Cards page behaviour)

- [ ] **Step 1: Update the roadmap row 6b** in `docs/open-items.md` to "Built" with the branch and date; change O-F6 to say the workspace (`mb.workspace.<state>`) is the second thing 6c moves to the database, and add rows for anything the build deferred (for example a rename-on-double-click if only the menu was built, or Move to tab if dropped). Set the spec's status line to say built, with the branch name. Do not create a separate progress file.
- [ ] **Step 2: Record any deviation** the build made from the spec as a row in `docs/open-items.md`, with its reason.
- [ ] **Step 3: State what was not run.** In the final report to the user, say that live (production) checks were not run and give the manual steps: open the Cards page for a state, add two cards, drag, resize, reload.
- [ ] **Step 4: Commit** the changed docs with `docs: canvas and tabs built (6b)`.
