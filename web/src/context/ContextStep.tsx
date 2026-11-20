import { Text, Title } from "@mantine/core";
import { tokens } from "../theme";
import { ContextDialog } from "./ContextDialog";
import styles from "./ContextDialog.module.css";
import { useDashboardContext } from "./urlContext";

/** The first screen: choose the state, level and rounds once; Continue opens the canvas. The bar edits them later. */
export function ContextStep() {
  const { setCtx } = useDashboardContext();
  return (
    <div className={styles.step}>
      <header className={styles.stepHeader}>
        <Title order={1} fz={tokens.font.pageTitle} fw={700}>Survey context</Title>
        <Text className={styles.stepLead}>
          Choose the state, survey level and rounds once. Every card on the canvas uses them, and you can change them later from the top bar.
        </Text>
      </header>
      <div className={styles.stepPanel}>
        <ContextDialog variant="step" context={null} planError={null} onCancel={() => undefined} onApply={setCtx} />
      </div>
    </div>
  );
}
