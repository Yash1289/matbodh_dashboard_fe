import { Button, Group, Modal } from "@mantine/core";
import { Fragment, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { useCardPlan, useSurveys } from "../api/queries";
import type { CardRef } from "../api/types";
import { tokens } from "../theme";
import { ContextDialog } from "./ContextDialog";
import styles from "./ContextDialog.module.css";
import { contextSummary } from "./summary";
import { clearCohort } from "../cohorts/cohortStore";
import { useDashboardContext } from "./urlContext";

// The context bar only needs the plan's round list, so it plans a card of its own, not a library card.
const CONTEXT_CARD: CardRef = {
  card: { id: "context", family: "distribution", title: "Context", all_party_scenarios: true },
};

// The state leads in weight; the rest is the detail it qualifies. The text stays one string for readers and copy.
function pillParts(summary: string) {
  return summary.split(" · ").map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <span className={styles.pillSep}> · </span>}
      <span className={i === 0 ? styles.pillState : undefined}>{part}</span>
    </Fragment>
  ));
}

export function ContextBar() {
  const { ctx, setCtx } = useDashboardContext();
  const [open, setOpen] = useState(false);
  const surveys = useSurveys(ctx?.state ?? null);
  const plan = useCardPlan(CONTEXT_CARD, ctx);
  const close = () => setOpen(false);

  // Back to a URL without a context must not leave the editor armed to reopen with the next one.
  useEffect(() => {
    if (ctx === null) setOpen(false);
  }, [ctx]);

  const summary = ctx && surveys.data ? contextSummary(ctx, surveys.data) : null;
  const planError = plan.error instanceof ApiError ? (plan.error.errors.join("; ") || plan.error.message) : null;

  // Before a context exists the first step owns the choice; the bar has nothing to summarise or edit.
  if (ctx === null) return null;

  return (
    <>
      <Group justify="space-between" wrap="nowrap" gap={14} style={{ flex: 1, minWidth: 0 }}>
        <div data-testid="context-pill" className={styles.contextPill} title={summary ?? undefined}>
          {summary ? pillParts(summary) : "Loading context…"}
        </div>
        {ctx.cohort && (
          <Group gap={8} wrap="nowrap" data-testid="cohort-pill">
            <div className={styles.contextPill} title={ctx.cohort.label}>
              Cohort · {ctx.cohort.label} · {ctx.cohort.seat_ids.length} {ctx.cohort.seat_level.toUpperCase()} seats
            </div>
            <Button variant="default" px={10} py={6} h="auto" fz={tokens.font.button} onClick={() => clearCohort(ctx.state)}>
              Clear cohort
            </Button>
          </Group>
        )}
        <Button className={styles.trigger} variant="default" px={14} py={8} h="auto" fz={tokens.font.button} fw={600}
          aria-haspopup="dialog" onClick={() => setOpen(true)}>
          Edit context
        </Button>
      </Group>
      <Modal
        opened={open} onClose={close} centered size={920} radius="lg" title="Survey context"
        closeOnClickOutside={false} closeButtonProps={{ "aria-label": "Close survey context" }}
        overlayProps={{ backgroundOpacity: 0.34 }} transitionProps={{ duration: 0 }}
        classNames={{ content: styles.dialog, header: styles.header, title: styles.title, body: styles.body }}
      >
        {open && (
          <ContextDialog key={JSON.stringify(ctx)} context={ctx} planError={planError} onCancel={close}
            onApply={(next) => { setCtx(next); close(); }} />
        )}
      </Modal>
    </>
  );
}
