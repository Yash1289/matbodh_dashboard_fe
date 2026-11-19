import { Alert, Button, Group, Modal, NativeSelect, NumberInput, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError, getRun } from "../api/client";
import type { BenchmarkReference, CardRef, CohortPreview, SelectionPredicate, StateContext } from "../api/types";
import { startPreview } from "./cohortApi";
import { setCohort } from "./cohortStore";

const POLL_MS = 1500;
const MAX_LISTED = 40;

interface Props {
  opened: boolean;
  onClose(): void;
  card: CardRef;
  kind: "ranking" | "benchmark";
  ctx: StateContext;
  reference: BenchmarkReference | null;
  /** A flip compares two endpoints, so it is offered only when the card has a reference. */
  hasReference: boolean;
  cardTitle: string;
}

const message = (e: unknown) => (e instanceof ApiError ? e.errors.join("; ") || e.message : e instanceof Error ? e.message : String(e));
const num = (v: number | string): number | undefined => (v === "" ? undefined : Number(v));
const describe = (p: SelectionPredicate) =>
  Object.entries(p).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ");

const FLIPS = [["", "Any"], ["gain", "Gain"], ["loss", "Loss"], ["winning_both", "Winning in both"], ["losing_both", "Losing in both"]];

/** Picks the selection for a seat ranking or benchmark card, previews the seat list, and keeps it as the session cohort. */
export function CohortDialog({ opened, onClose, card, kind, ctx, reference, hasReference, cardTitle }: Props) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const [fields, setFields] = useState<Record<string, number | string>>({});
  const [runId, setRunId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const field = (name: string) => fields[name] ?? "";
  const edit = (name: string) => (value: number | string) => {
    setFields((f) => ({ ...f, [name]: value }));
    setRunId(null); // a changed selection makes the previous preview stale
    setStartError(null);
  };

  const raw: Record<string, number | string | undefined> = kind === "ranking"
    ? { rank_max: num(field("rank_max")), metric_min: num(field("metric_min")), metric_max: num(field("metric_max")) }
    : {
      endpoint: field("endpoint") || undefined, status: field("status") || undefined,
      margin_min: num(field("margin_min")), margin_max: num(field("margin_max")),
      flip: hasReference ? field("flip") || undefined : undefined,
    };
  const predicate = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) as SelectionPredicate;
  const empty = Object.keys(predicate).length === 0;

  const run = useQuery({
    queryKey: ["cohort-preview", runId],
    queryFn: () => getRun(runId as string),
    enabled: runId !== null,
    refetchInterval: (q) => (q.state.status !== "error" && q.state.data?.state === "running" ? POLL_MS : false),
  });
  const preview = run.data?.state === "done" ? (run.data.result as unknown as CohortPreview) : null;
  const failure = startError ?? (run.isError ? message(run.error) : null)
    ?? (run.data?.state === "failed" ? Object.values(run.data.errors).map((e) => e.message).join("; ") : null);
  const running = runId !== null && preview === null && failure === null;

  const preparePreview = () => {
    setStartError(null);
    startPreview(card, ctx, predicate, reference).then(setRunId, (e: unknown) => setStartError(message(e)));
  };

  const use = () => {
    if (preview === null || preview.count === 0) return;
    setCohort(ctx.state, {
      seat_level: preview.seat_level, seat_ids: preview.seat_ids,
      label: `${cardTitle} · ${describe(predicate)}`.slice(0, 120), created_at: new Date().toISOString(),
    });
    onClose();
    navigate({ pathname: "/cohort", search });
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Make cohort" centered>
      <Stack gap="sm">
        <Text size="sm" c="var(--mb-muted)">
          Selects seats from this card&apos;s own result, in the whole state. The list is kept for this session only.
        </Text>
        {kind === "ranking" ? (
          <>
            <NumberInput label="Top N in each group" min={1} allowDecimal={false} value={field("rank_max")} onChange={edit("rank_max")} />
            <Group grow>
              <NumberInput label="Metric at least" value={field("metric_min")} onChange={edit("metric_min")} />
              <NumberInput label="Metric below" value={field("metric_max")} onChange={edit("metric_max")} />
            </Group>
          </>
        ) : (
          <>
            <NativeSelect label="Status" value={String(field("status"))} onChange={(e) => edit("status")(e.currentTarget.value)}
              data={[{ value: "", label: "Any" }, { value: "winning", label: "Winning" }, { value: "losing", label: "Losing" }]} />
            <NativeSelect label="Endpoint" value={String(field("endpoint"))} onChange={(e) => edit("endpoint")(e.currentTarget.value)}
              data={[{ value: "", label: "Default" }, { value: "target", label: "This survey" },
                ...(hasReference ? [{ value: "reference", label: "Reference" }] : [])]} />
            <Group grow>
              <NumberInput label="Margin at least" value={field("margin_min")} onChange={edit("margin_min")} />
              <NumberInput label="Margin below" value={field("margin_max")} onChange={edit("margin_max")} />
            </Group>
            {hasReference && (
              <NativeSelect label="Flip" value={String(field("flip"))} onChange={(e) => edit("flip")(e.currentTarget.value)}
                data={FLIPS.map(([value, label]) => ({ value, label }))} />
            )}
          </>
        )}
        {failure !== null && <Alert color="red" role="alert">{failure}</Alert>}
        {preview !== null && (
          <div>
            <Text fw={600}>{preview.count === 0 ? "No seats matched" : `${preview.count} seat${preview.count === 1 ? "" : "s"} matched`}</Text>
            {preview.count > 0 && (
              <Text size="sm" c="var(--mb-muted)">
                {preview.seat_level.toUpperCase()} {preview.seat_ids.slice(0, MAX_LISTED).join(", ")}{preview.count > MAX_LISTED ? " …" : ""}
              </Text>
            )}
          </div>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button variant="default" disabled={empty || running} loading={running} onClick={preparePreview}>Preview</Button>
          <Button disabled={preview === null || preview.count === 0} onClick={use}>Use as cohort</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
