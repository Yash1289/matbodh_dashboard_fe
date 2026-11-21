import { SegmentedControl } from "@mantine/core";
import type { GridPayload } from "../api/types";
import { layoutNeeds, partiesOf, questionsOf, surveysOf, type LayoutView } from "./grid/layout";
import { PopoverChip } from "./PopoverChip";

interface Props {
  payload: GridPayload;
  cut: string;
  view: LayoutView;
  onView: (patch: LayoutView) => void;
}

/**
 * One chip per thing the layout shows one at a time: a survey, a question, or a party (display only). Each is a
 * chip with a popover like the Lens, Format and Sort controls, and says what it is: "Party: NDA".
 */
export function LayoutSelectors({ payload, cut, view, onView }: Props) {
  const need = layoutNeeds(payload, cut);
  if (!need.survey && !need.question && !need.party) return null;
  const chip = (label: string, data: { value: string; label: string }[], value: string | null | undefined, key: keyof LayoutView) => {
    const current = data.find((d) => d.value === value) ?? data[0];
    return (
      <PopoverChip label={`${label}: ${current?.label ?? ""} ▾`} selected={current !== undefined && current.value !== data[0]?.value}>
        <SegmentedControl size="xs" aria-label={label} orientation="vertical" data={data}
          value={current?.value} onChange={(v) => onView({ [key]: v })} />
      </PopoverChip>
    );
  };
  return (
    <>
      {need.survey && chip("Survey", surveysOf(payload).map((s) => ({ value: s.obs_id, label: s.label })), view.survey, "survey")}
      {need.question && chip("Question", questionsOf(payload).map((q) => ({ value: q, label: q })), view.question, "question")}
      {need.party && chip("Party", partiesOf(payload).map((p) => ({ value: p, label: p })), view.party, "party")}
    </>
  );
}
