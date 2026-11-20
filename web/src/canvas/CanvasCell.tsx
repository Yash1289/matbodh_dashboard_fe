import type { ReactNode } from "react";
import styles from "./canvas.module.css";

interface Props {
  cardId: string;
  /** A drag handle (pointer only, hidden from assistive tech: the card menu has Move) is shown on the grid layout only; the one-column layout cannot be rearranged. */
  draggable: boolean;
  /** The card's actions (the menu), shown at the right of the toolbar. */
  menu?: ReactNode;
  children: ReactNode;
}

/** One card on the canvas: a slim toolbar (drag handle and menu) above the card, which scrolls inside the cell. */
export function CanvasCell({ cardId, draggable, menu, children }: Props) {
  return (
    <div className={styles.cell}>
      <div className={styles.toolbar}>
        {draggable ? <span className={`canvas-handle ${styles.handle}`} aria-hidden="true" title="Drag to move">⠿ Move</span> : <span />}
        {menu}
      </div>
      <div className={styles.body} data-card-body={cardId}>{children}</div>
    </div>
  );
}
