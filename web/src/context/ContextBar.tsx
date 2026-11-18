import { Button, Group, Modal } from "@mantine/core";
import { Fragment, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { useCardPlan, useSurveys } from "../api/queries";
import { tokens } from "../theme";
import { ContextDialog } from "./ContextDialog";
import styles from "./ContextDialog.module.css";
import { contextSummary } from "./summary";
import { clearCohort } from "../cohorts/cohortStore";
import { useDashboardContext } from "./urlContext";

const LEAD_CARD = "distribution.support_by_caste";

function pillParts(summary: string) {
  return summary.split(" · ").map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <span style={{ color: "var(--mb-muted)" }}> · </span>}
      <span>{part}</span>
    </Fragment>
  ));
}

export function ContextBar() {
  const { ctx, setCtx } = useDashboardContext();
  const [open, setOpen] = useState(ctx === null);
  const surveys = useSurveys(ctx?.state ?? null);
  const plan = useCardPlan(LEAD_CARD, ctx);
  const close = () => setOpen(false);

  useEffect(() => {
    if (ctx === null) setOpen(true);
  }, [ctx]);

  const summary = ctx && surveys.data ? contextSummary(ctx, surveys.data) : null;
  const planError = plan.error instanceof ApiError ? (plan.error.errors.join("; ") || plan.error.message) : null;

  return (
    <>
      <Group justify="space-between" wrap="nowrap" gap={14} style={{ flex: 1, minWidth: 0 }}>
        <div data-testid="context-pill" className={styles.contextPill} title={summary ?? undefined}>
          {summary ? pillParts(summary) : ctx ? "Loading context…" : "No context chosen"}
        </div>
        {ctx?.cohort && (
          <Group gap={8} wrap="nowrap" data-testid="cohort-pill">
            <div className={styles.contextPill} title={ctx.cohort.label}>
              Cohort · {ctx.cohort.label} · {ctx.cohort.seat_ids.length} {ctx.cohort.seat_level.toUpperCase()} seats
            </div>
            <Button variant="default" px={10} py={6} h="auto" fz={tokens.font.button} onClick={() => clearCohort(ctx.state)}>
              Clear cohort
            </Button>
          </Group>
        )}
        <Button className={styles.trigger} px={14} py={8} h="auto" fz={tokens.font.button} fw={600}
          aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {ctx ? "Edit context" : "Choose surveys"}
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
