import { useEffect, useRef, useState, type ReactNode } from "react";
import { takeFresh } from "./fresh";
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
  // A card the analyst just added or copied arrives with a short ring and is brought into view; cards that are merely redrawn do not.
  const [fresh] = useState(() => takeFresh(cardId));
  const cell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fresh) cell.current?.scrollIntoView?.({ block: "nearest", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [fresh]);
  return (
    <div ref={cell} className={fresh ? `${styles.cell} ${styles.fresh}` : styles.cell} data-fresh={fresh || undefined}>
      <div className={styles.toolbar}>
        {draggable ? <span className={`canvas-handle ${styles.handle}`} aria-hidden="true" title="Drag to move">⠿ Move</span> : <span />}
        {menu}
      </div>
      <div className={styles.body} data-card-body={cardId}>{children}</div>
    </div>
  );
}
