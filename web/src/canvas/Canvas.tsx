import { Button, Group, VisuallyHidden } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { useEffect, useRef, useState } from "react";
import { GridLayout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import type { ReactNode } from "react";
import { tokens } from "../theme";
import { CanvasCell } from "./CanvasCell";
import styles from "./canvas.module.css";
import { CardMenu } from "./CardMenu";
import { COLUMNS, ROW_GAP, ROW_HEIGHT, fitAllHeights, readingOrder, rowsFor, type Item } from "./layout";
import { useWorkspace, workspaceStore, type Tab } from "./workspaceStore";

/**
 * Below this canvas width the grid gives way to one column in reading order, with no dragging.
 * It is the width at which a half-width (6 of 12 columns) card is still about 480px wide.
 */
export const NARROW_PAGE = 980;

/** Pixels: a content height under this is a card that is not rendered (yet), not a card to shrink to. */
const MIN_MEASURED = 60;

interface Props {
  state: string;
  tab: Tab;
  renderCard(cardId: string): ReactNode;
  onConfigure(cardId: string): void;
  /** Told after a Remove, with the way to undo it. */
  onRemoved?(undo: () => void): void;
}

/** The corner is the obvious grip; the right and bottom edges resize too, with a hit area along the whole edge. */
const RESIZE_HANDLES = ["se", "e", "s"] as const;
const resizeHandle = (axis: string, ref: React.Ref<HTMLElement>) => (
  <span ref={ref as React.Ref<HTMLSpanElement>} className={`react-resizable-handle react-resizable-handle-${axis} canvas-grip`} data-axis={axis}
    title={axis === "se" ? "Drag to resize" : axis === "e" ? "Drag to change width" : "Drag to change height"} />
);

type GridItem = { i: string; x: number; y: number; w: number; h: number };
/** Positions from the grid; a height is kept as set by hand only for the card just resized or one already manual. */
const fromGrid = (layout: readonly GridItem[], before: Item[], resized?: string): Item[] =>
  layout.map((l) => {
    const manual = l.i === resized || before.find((b) => b.cardId === l.i)?.manual === true;
    return { cardId: l.i, x: l.x, y: l.y, w: l.w, h: l.h, ...(manual ? { manual: true } : {}) };
  });

/** The tab's cards on a snapped 12-column grid; the arrangement is saved when a drag or resize ends. */
export function Canvas({ state, tab, renderCard, onConfigure, onRemoved }: Props) {
  const { ref, width } = useElementSize();
  const { tabs } = useWorkspace(state);
  // One live region for the whole canvas: a card that is removed or moved away takes its own menu with it.
  const [said, setSaid] = useState("");
  const save = (layout: readonly GridItem[], resized?: string) => workspaceStore.setItems(state, tab.id, fromGrid(layout, tab.items, resized));
  const gap = tokens.layout.gap;
  /** The part of the card gap the grid does not keep between rows: padding at the foot of each cell. */
  const cellPad = gap - ROW_GAP;
  // While a card is being dragged or resized its neighbours must not change height under the pointer.
  const interacting = useRef(false);
  const stacked = width !== 0 && width < NARROW_PAGE;

  /** The card's own height (its toolbar and its content, whatever the cell is now), in grid rows; null while it has nothing to measure. */
  const rowsOf = (cardId: string): number | null => {
    const body = ref.current?.querySelector(`[data-card-body="${CSS.escape(cardId)}"]`);
    const content = body?.firstElementChild?.getBoundingClientRect().height ?? 0;
    // A rendered card is never this short (its title row alone is taller): below it nothing has rendered yet, so keep the stored height.
    return content < MIN_MEASURED ? null : rowsFor(content + (body?.previousElementSibling?.getBoundingClientRect().height ?? 0) + (stacked ? 0 : cellPad));
  };
  const measureRows = (cardId: string) => () => rowsOf(cardId) ?? tab.items.find((i) => i.cardId === cardId)?.h ?? 1;

  // Cards that were not sized by hand follow their content: it changes with the width (zoom, window, wrapping) and as data arrives.
  const [rows, setRows] = useState<Record<string, number>>({});
  const [reattach, setReattach] = useState(0);
  const ids = tab.items.map((i) => i.cardId).join("|");
  useEffect(() => {
    const root: HTMLElement | null = ref.current;
    if (root === null || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      if (interacting.current) return;
      const next: Record<string, number> = {};
      for (const id of ids === "" ? [] : ids.split("|")) {
        const r = rowsOf(id);
        if (r !== null) next[id] = r;
      }
      setRows((prev) => (Object.keys(next).length === Object.keys(prev).length && Object.keys(next).every((k) => prev[k] === next[k]) ? prev : next));
    };
    const resizes = new ResizeObserver(measure);
    const changes = new MutationObserver(() => setReattach((n) => n + 1));
    root.querySelectorAll<HTMLElement>("[data-card-body]").forEach((body) => {
      if (body.firstElementChild) resizes.observe(body.firstElementChild);
      if (body.previousElementSibling) resizes.observe(body.previousElementSibling);
      changes.observe(body, { childList: true });
    });
    measure();
    return () => { resizes.disconnect(); changes.disconnect(); };
    // rowsOf only reads the root and the gap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, stacked, reattach]);
  const heightOf = (i: Item) => (i.manual === true ? i.h : rows[i.cardId] ?? i.h);
  /** Every card to its own content height in one save, so the blank bands under short cards close. */
  const fitAll = () => {
    const measured = Object.fromEntries(tab.items.flatMap((i) => { const r = rowsOf(i.cardId); return r === null ? [] : [[i.cardId, r]]; }));
    workspaceStore.setItems(state, tab.id, fitAllHeights(tab.items, measured));
    setSaid(`Fitted ${tab.items.length} ${tab.items.length === 1 ? "card" : "cards"} to their content`);
  };
  /** After a card leaves the tab, focus the next card's menu (or the previous one's, or the active tab). */
  const focusAfterLeaving = (cardId: string) => {
    const order = readingOrder(tab.items).map((i) => i.cardId);
    const at = order.indexOf(cardId);
    const next = order[at + 1] ?? order[at - 1];
    requestAnimationFrame(() => {
      const menu = next === undefined ? null
        : (ref.current as HTMLElement | null)?.querySelector(`[data-card-body="${CSS.escape(next)}"]`)?.parentElement?.querySelector<HTMLElement>('button[aria-label^="Card actions"]');
      (menu ?? document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))?.focus();
    });
  };
  const cell = (cardId: string, draggable: boolean) => (
    <CanvasCell cardId={cardId} draggable={draggable}
      menu={<CardMenu state={state} tab={tab} tabs={tabs} cardId={cardId} onConfigure={onConfigure} measureRows={measureRows(cardId)}
        announce={setSaid} onGone={focusAfterLeaving} onRemoved={onRemoved} />}>
      {renderCard(cardId)}
    </CanvasCell>
  );

  const body = (() => {
    // Before the first measurement (and where nothing can be measured) the grid is laid out at the usual page width.
    if (stacked) {
      return (
        <div className={styles.stack}>
          {readingOrder(tab.items).map((i) => <div key={i.cardId}>{cell(i.cardId, false)}</div>)}
        </div>
      );
    }
    return (
      <>
        {tab.items.length > 1 && (
          <Group justify="flex-end" mb={4}>
            <Button variant="subtle" size="compact-sm" onClick={fitAll}>Fit all heights</Button>
          </Group>
        )}
        <GridLayout
          width={width === 0 ? tokens.layout.content : width}
          layout={tab.items.map((i) => ({ i: i.cardId, x: i.x, y: i.y, w: i.w, h: heightOf(i) }))}
          gridConfig={{ cols: COLUMNS, rowHeight: ROW_HEIGHT, margin: [gap, ROW_GAP], containerPadding: [0, 0] }}
          dragConfig={{ enabled: true, handle: ".canvas-handle" }}
          resizeConfig={{ enabled: true, handles: RESIZE_HANDLES, handleComponent: resizeHandle }}
          onDragStart={() => { interacting.current = true; }}
          onResizeStart={() => { interacting.current = true; }}
          onDragStop={(layout) => { interacting.current = false; save(layout); }}
          onResizeStop={(layout, _old, now) => { interacting.current = false; save(layout, now?.i); }}
        >
          {tab.items.map((i) => <div key={i.cardId}>{cell(i.cardId, true)}</div>)}
        </GridLayout>
      </>
    );
  })();

  return (
    <div ref={ref}>
      {body}
      <VisuallyHidden role="status" aria-live="polite">{said}</VisuallyHidden>
    </div>
  );
}
