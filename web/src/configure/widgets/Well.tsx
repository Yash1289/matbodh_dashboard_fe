import { useId, type ReactNode } from "react";
import styles from "./wells.module.css";

interface Props {
  title: string;
  /** Explanation under the header, in the field's own words. */
  hint?: ReactNode;
  /** A short count or state at the right of the header ("3 selected"). */
  badge?: string | null;
  children: ReactNode;
}

/** A framed field well: a header bar (name and count) over its controls, like a BI tool's build pane. */
export function Well({ title, hint, badge, children }: Props) {
  const id = useId();
  return (
    <section className={styles.well} role="group" aria-labelledby={id}>
      <header className={styles.head}>
        <span id={id} className={styles.title}>{title}</span>
        {badge ? <span className={styles.badge}>{badge}</span> : null}
      </header>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      <div className={styles.body}>{children}</div>
    </section>
  );
}

/** Props that lay a Mantine input out as a property row: the label at the left, the control at the right. */
export const rowProps = {
  size: "sm",
  inputWrapperOrder: ["label", "input", "description", "error"] as ("label" | "input" | "description" | "error")[],
  classNames: { root: styles.row, label: styles.rowLabel, wrapper: styles.rowControl, description: styles.rowNote, error: styles.rowNote },
};
