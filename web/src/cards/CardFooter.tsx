import { Anchor, Group, Text } from "@mantine/core";
import type { GridPayload } from "../api/types";
import type { CellGrid } from "../table/grid";
import { tokens } from "../theme";
import { coverageNote, excludedNote, flagLegend, notAskedNote } from "./coverage";

/** Reports only what the API sent; computes no survey numbers. */
export function CardFooter({ payload, grid, onMethod }: { payload: GridPayload; grid: CellGrid; onMethod: () => void }) {
  const notes = [
    coverageNote(payload.rounds),
    excludedNote(payload),
    notAskedNote(payload),
    payload.hidden_count > 0 ? `${payload.hidden_count} values hidden` : null,
  ].filter((n): n is string => n !== null && n !== "");
  const flags = flagLegend(grid);
  const flagText = flags.map((f) => (f.glyph ? `${f.glyph} ${f.reason}` : f.reason)).join(" · ");
  const method = `Method: rules ${payload.rules_version} · engine ${payload.engine_version} · metadata r${payload.metadata_revision} · alliances e${payload.alliance_epoch}`;
  const parts = [...notes, ...(flagText ? [flagText] : []), method];
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md" data-testid="card-footer">
      <Text fz={tokens.font.subtitle} c="var(--mb-muted)" m={0}>
        {parts.map((p, i) => (
          <span key={p}>{i > 0 && " · "}<span>{p}</span></span>
        ))}
      </Text>
      <Anchor component="button" type="button" fz={tokens.font.subtitle} c="var(--mb-primary)" style={{ whiteSpace: "nowrap" }} onClick={onMethod}>
        How this was calculated →
      </Anchor>
    </Group>
  );
}
