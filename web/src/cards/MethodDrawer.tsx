import { Code, Stack, Text, Title } from "@mantine/core";
import { RelationshipMethod } from "./relationship/RelationshipMethod";
import { isBenchmarkPayload, isRankedPayload, isRelationshipPayload, type CardPayload, type PlanResponse, type RunError } from "../api/types";

interface Props {
  payload: CardPayload | null;
  plan: PlanResponse | null;
  errors: Record<string, RunError>;
}

/** Read-only method detail; the only place fingerprints appear. */
export function MethodDrawer({ payload, plan, errors }: Props) {
  const rounds = payload?.rounds.items ?? plan?.rounds ?? [];
  const modes = Object.entries(plan?.coverage_mode ?? {});
  const errs = Object.entries(errors);
  return (
    <Stack gap="sm">
      <Title order={3}>Rounds</Title>
      {rounds.length === 0 && <Text size="sm">No result yet</Text>}
      {rounds.map((r) => (
        <Text key={r.obs_id} size="sm">
          {r.base_name} · dataset {r.dataset_id} · {r.version}{r.fallback ? " (fallback)" : ""} · {r.seats} seats
        </Text>
      ))}
      {modes.length > 0 && <Title order={3}>Coverage mode</Title>}
      {modes.map(([part, mode]) => <Text key={part} size="sm">{part}: {mode ?? "—"}</Text>)}
      {payload && isRelationshipPayload(payload) && <RelationshipMethod payload={payload} />}
      {payload && (
        <>
          <Title order={3}>Contract</Title>
          <Code block>{JSON.stringify(
            isBenchmarkPayload(payload) || isRelationshipPayload(payload) ? payload.contract
              : isRankedPayload(payload) ? payload.contracts : payload.provenance.contract, null, 2)}</Code>
          {!isBenchmarkPayload(payload) && !isRelationshipPayload(payload) && (
            <>
              <Title order={3}>Coverage</Title>
              <Code block>{JSON.stringify(payload.coverage, null, 2)}</Code>
            </>
          )}
        </>
      )}
      {errs.length > 0 && <Title order={3}>Errors</Title>}
      {errs.map(([part, e]) => (
        <Text key={part} size="sm">
          {part}: {e.kind} · {e.message} · fingerprint {e.fingerprint ?? "—"}
        </Text>
      ))}
    </Stack>
  );
}
