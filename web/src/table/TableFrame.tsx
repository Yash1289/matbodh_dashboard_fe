import { useState, type CSSProperties, type ReactNode } from "react";
import styles from "./TableFrame.module.css";

/** Class for the first cell of every row: it stays in view while the rest scrolls sideways. */
export const PIN = styles.pin;

interface Props {
  children: ReactNode;
  /** Minimum table width in em; a narrower card then scrolls sideways instead of hiding columns. */
  minWidthEm?: number;
  /** Limit the height (e.g. "70vh") so a long table scrolls under a header that stays in view. */
  maxHeight?: string;
}

export function TableFrame({ children, minWidthEm, maxHeight }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const style = {
    ...(minWidthEm === undefined ? {} : { "--table-min": `${minWidthEm}em` }),
    ...(maxHeight === undefined ? {} : { maxHeight }),
  } as CSSProperties;
  return (
    <div
      className={styles.scroller}
      data-testid="table-frame"
      data-scrolled={scrolled}
      style={style}
      onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 2)}
    >
      {children}
    </div>
  );
}
