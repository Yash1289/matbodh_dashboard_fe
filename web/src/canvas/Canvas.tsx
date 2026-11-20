import { useElementSize } from "@mantine/hooks";
import { GridLayout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import type { ReactNode } from "react";
import { tokens } from "../theme";
import { CanvasCell } from "./CanvasCell";
import styles from "./canvas.module.css";
import { COLUMNS, readingOrder, type Item } from "./layout";
import { workspaceStore, type Tab } from "./workspaceStore";

/** Below this page width the grid gives way to one column in reading order, with no dragging. */
export const NARROW_PAGE = 640;
export const ROW_HEIGHT = 40;

interface Props {
  state: string;
  tab: Tab;
  renderCard(cardId: string): ReactNode;
}

type GridItem = { i: string; x: number; y: number; w: number; h: number };
const fromGrid = (layout: readonly GridItem[]): Item[] => layout.map((l) => ({ cardId: l.i, x: l.x, y: l.y, w: l.w, h: l.h }));

/** The tab's cards on a snapped 12-column grid; the arrangement is saved when a drag or resize ends. */
export function Canvas({ state, tab, renderCard }: Props) {
  const { ref, width } = useElementSize();
  const save = (layout: readonly GridItem[]) => workspaceStore.setItems(state, tab.id, fromGrid(layout));
  const gap = tokens.layout.gap;

  const body = (() => {
    if (width === 0) return null; // not measured yet: a grid at width 0 would flash
    if (width < NARROW_PAGE) {
      return (
        <div className={styles.stack}>
          {readingOrder(tab.items).map((i) => <CanvasCell key={i.cardId} draggable={false}>{renderCard(i.cardId)}</CanvasCell>)}
        </div>
      );
    }
    return (
      <GridLayout
        width={width}
        layout={tab.items.map((i) => ({ i: i.cardId, x: i.x, y: i.y, w: i.w, h: i.h }))}
        gridConfig={{ cols: COLUMNS, rowHeight: ROW_HEIGHT, margin: [gap, gap], containerPadding: [0, 0] }}
        dragConfig={{ enabled: true, handle: ".canvas-handle" }}
        resizeConfig={{ enabled: true }}
        onDragStop={save}
        onResizeStop={save}
      >
        {tab.items.map((i) => <div key={i.cardId}><CanvasCell draggable>{renderCard(i.cardId)}</CanvasCell></div>)}
      </GridLayout>
    );
  })();

  return <div ref={ref}>{body}</div>;
}
