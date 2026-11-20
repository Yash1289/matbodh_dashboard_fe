import { Stack, Text, Title } from "@mantine/core";
import type { RelationshipPayload } from "../../api/types";

const asText = (v: unknown): string => (typeof v === "string" ? v : "");

/** The relationship's own method lines, read from the engine contract; the raw contract follows in the drawer. */
export function RelationshipMethod({ payload }: { payload: RelationshipPayload }) {
  const weights = payload.weights as { source?: string; scenario?: string | null; mode?: string };
  const identities = (payload.contract.identities as { version?: string }[] | undefined) ?? [];
  const versions = [...new Set(identities.map((i) => i.version).filter((v): v is string => typeof v === "string"))];
  const units = payload.contract.units as Record<string, string> | undefined;
  return (
    <Stack gap={4}>
      <Title order={3}>Relationship</Title>
      <Text size="sm">{payload.origin} → {payload.destination}</Text>
      <Text size="sm">{payload.focal_party === null ? "No focal party (agreement only)" : `Focal party: ${payload.focal_party}`}</Text>
      <Text size="sm">Joint weight: {weights.source ?? "unknown"}{weights.source === "scenario" ? ` (${weights.scenario}, ${weights.mode})` : ""}</Text>
      {payload.answer_overrides && (
        <Text size="sm">Recalled statuses included (widens the paired base): {Object.entries(payload.answer_overrides)
          .map(([endpoint, o]) => `${endpoint}: ${o.include.join(", ")}`).join("; ")}</Text>
      )}
      {versions.length > 0 && <Text size="sm">Alliance mapping {versions.join(", ")}, the same on both axes</Text>}
      {asText(payload.contract.eligibility) && <Text size="sm">Eligibility: {asText(payload.contract.eligibility)}</Text>}
      {units && <Text size="sm">Units: shares are {units.shares}; impacts and net flow are {units.impacts_and_net_flow?.replace("_", " ")}</Text>}
      <Text size="sm">Each round is its own matrix; respondents are never joined across rounds.</Text>
    </Stack>
  );
}
