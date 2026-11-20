import { useElementSize } from "@mantine/hooks";
import { GridLayout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import type { ReactNode } from "react";
import { tokens } from "../theme";
import { CanvasCell } from "./CanvasCell";
import styles from "./canvas.module.css";
import { CardMenu } from "./CardMenu";
import { COLUMNS, ROW_HEIGHT, readingOrder, rowsFor, type Item } from "./layout";
import { useWorkspace, workspaceStore, type Tab } from "./workspaceStore";

/** Below this page width the grid gives way to one column in reading order, with no dragging. */
export const NARROW_PAGE = 640;

interface Props {
  state: string;
  tab: Tab;
  renderCard(cardId: string): ReactNode;
  onConfigure(cardId: string): void;
}

type GridItem = { i: string; x: number; y: number; w: number; h: number };
const fromGrid = (layout: readonly GridItem[]): Item[] => layout.map((l) => ({ cardId: l.i, x: l.x, y: l.y, w: l.w, h: l.h }));

/** The tab's cards on a snapped 12-column grid; the arrangement is saved when a drag or resize ends. */
export function Canvas({ state, tab, renderCard, onConfigure }: Props) {
  const { ref, width } = useElementSize();
  const { tabs } = useWorkspace(state);
  const save = (layout: readonly GridItem[]) => workspaceStore.setItems(state, tab.id, fromGrid(layout));
  const gap = tokens.layout.gap;

  /** The card's own content height, in grid rows (for Fit to content). */
  const measureRows = (cardId: string) => () => {
    const content = ref.current?.querySelector(`[data-card-body="${CSS.escape(cardId)}"]`)?.firstElementChild;
    return rowsFor(content?.getBoundingClientRect().height ?? 0, gap);
  };
  const cell = (cardId: string, draggable: boolean) => (
    <CanvasCell cardId={cardId} draggable={draggable}
      menu={<CardMenu state={state} tab={tab} tabs={tabs} cardId={cardId} onConfigure={onConfigure} measureRows={measureRows(cardId)} />}>
      {renderCard(cardId)}
    </CanvasCell>
  );

  const body = (() => {
    // Before the first measurement (and where nothing can be measured) the grid is laid out at the usual page width.
    if (width !== 0 && width < NARROW_PAGE) {
      return (
        <div className={styles.stack}>
          {readingOrder(tab.items).map((i) => <div key={i.cardId}>{cell(i.cardId, false)}</div>)}
        </div>
      );
    }
    return (
      <GridLayout
        width={width === 0 ? tokens.layout.content : width}
        layout={tab.items.map((i) => ({ i: i.cardId, x: i.x, y: i.y, w: i.w, h: i.h }))}
        gridConfig={{ cols: COLUMNS, rowHeight: ROW_HEIGHT, margin: [gap, gap], containerPadding: [0, 0] }}
        dragConfig={{ enabled: true, handle: ".canvas-handle" }}
        resizeConfig={{ enabled: true }}
        onDragStop={save}
        onResizeStop={save}
      >
        {tab.items.map((i) => <div key={i.cardId}>{cell(i.cardId, true)}</div>)}
      </GridLayout>
    );
  })();

  return <div ref={ref}>{body}</div>;
}
