import { Stack, Text } from "@mantine/core";
import type { CardResult, Template } from "../api/types";
import type { CellGrid } from "../table/grid";
import { coverageNote, excludedNote, flagLegend, isSeatCard, notAskedNote } from "./coverage";

/** Reports only what the API sent; computes no survey numbers. */
export function CardFooter({ result, grid, template }: { result: CardResult; grid: CellGrid; template: Template }) {
  const notes = [
    isSeatCard(template) ? coverageNote(result.rounds) : null,
    excludedNote(result),
    notAskedNote(result),
    result.hidden_count > 0 ? `${result.hidden_count} values hidden` : null,
  ].filter((n): n is string => n !== null && n !== "");
  const flags = flagLegend(grid);
  return (
    <Stack gap={2}>
      {notes.map((n) => <Text key={n} size="xs" c="dimmed">{n}</Text>)}
      {flags.length > 0 && (
        <Text size="xs" c="dimmed">
          {flags.map((f) => (f.glyph ? `${f.glyph} ${f.reason}` : f.reason)).join(" · ")}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        {`Method: rules ${result.rules_version} · engine ${result.engine_version} · metadata r${result.metadata_revision} · alliances e${result.alliance_epoch}`}
      </Text>
    </Stack>
  );
}
