import { Anchor, Group, Text } from "@mantine/core";
import type { CardResult, Template } from "../api/types";
import type { CellGrid } from "../table/grid";
import { tokens } from "../theme";
import { coverageNote, excludedNote, flagLegend, isSeatCard, notAskedNote } from "./coverage";

/** Reports only what the API sent; computes no survey numbers. */
export function CardFooter({ result, grid, template, onMethod }: { result: CardResult; grid: CellGrid; template: Template; onMethod: () => void }) {
  const notes = [
    isSeatCard(template) ? coverageNote(result.rounds) : null,
    excludedNote(result),
    notAskedNote(result),
    result.hidden_count > 0 ? `${result.hidden_count} values hidden` : null,
  ].filter((n): n is string => n !== null && n !== "");
  const flags = flagLegend(grid);
  const flagText = flags.map((f) => (f.glyph ? `${f.glyph} ${f.reason}` : f.reason)).join(" · ");
  const method = `Method: rules ${result.rules_version} · engine ${result.engine_version} · metadata r${result.metadata_revision} · alliances e${result.alliance_epoch}`;
  const parts = [...notes, ...(flagText ? [flagText] : []), method];
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
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
