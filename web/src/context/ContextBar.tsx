import { Button, Modal } from "@mantine/core";
import { Fragment, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { useCardPlan, useSurveys } from "../api/queries";
import type { CardRef } from "../api/types";
import { ContextDialog } from "./ContextDialog";
import styles from "./ContextDialog.module.css";
import barStyles from "./ContextBar.module.css";
import { contextParts } from "./summary";
import { clearCohort } from "../cohorts/cohortStore";
import { useDashboardContext } from "./urlContext";

// The context bar only needs the plan's round list, so it plans a card of its own, not a library card.
const CONTEXT_CARD: CardRef = {
  card: { id: "context", family: "distribution", title: "Context", all_party_scenarios: true },
};

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

  const parts = ctx && surveys.data ? contextParts(ctx, surveys.data) : null;
  const summary = parts === null ? null : parts.map((p) => p.text).join(" · ");
  const planError = plan.error instanceof ApiError ? (plan.error.errors.join("; ") || plan.error.message) : null;

  // Before a context exists the first step owns the choice; the bar has nothing to summarise or edit.
  if (ctx === null) return null;

  return (
    <>
      <button type="button" className={barStyles.bar} aria-label="Edit context" aria-haspopup="dialog" title={summary ?? undefined}
        onClick={() => setOpen(true)}>
        <span data-testid="context-pill" className={barStyles.chips}>
          {parts === null ? <span className={barStyles.loading}>Loading context…</span> : parts.map((p, i) => (
            <Fragment key={p.kind}>
              {i > 0 && <span className={barStyles.sep}> · </span>}
              {/* A part whose text changed is a new element, so only it settles in again. */}
              <span key={p.text} className={barStyles.chip} data-kind={p.kind} style={{ "--i": i } as React.CSSProperties}>{p.text}</span>
            </Fragment>
          ))}
        </span>
        <span className={barStyles.edit} aria-hidden="true">
          <svg className={barStyles.pencil} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 2.5l2.5 2.5L5.5 13H3v-2.5z" />
          </svg>
          Edit
        </span>
      </button>
      {ctx.cohort && (
        <span className={barStyles.cohort} data-testid="cohort-pill">
          <span className={barStyles.cohortPill} title={ctx.cohort.label}>
            Cohort · {ctx.cohort.label} · {ctx.cohort.seat_ids.length} {ctx.cohort.seat_level.toUpperCase()} seats
          </span>
          <Button variant="white" size="compact-sm" color="dark" onClick={() => clearCohort(ctx.state)}>Clear cohort</Button>
        </span>
      )}
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
