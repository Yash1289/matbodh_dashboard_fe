import { NativeSelect } from "@mantine/core";
import type { GridPayload } from "../api/types";
import { layoutNeeds, partiesOf, questionsOf, surveysOf, type LayoutView } from "./grid/layout";

interface Props {
  payload: GridPayload;
  cut: string;
  view: LayoutView;
  onView: (patch: LayoutView) => void;
}

/** One selector per thing the layout shows one at a time: a survey, a question, or a party (display only). */
export function LayoutSelectors({ payload, cut, view, onView }: Props) {
  const need = layoutNeeds(payload, cut);
  if (!need.survey && !need.question && !need.party) return null;
  const select = (label: string, data: { value: string; label: string }[], value: string | null | undefined, key: keyof LayoutView) => (
    <NativeSelect size="xs" aria-label={label} data={data} value={value ?? data[0]?.value}
      onChange={(e) => onView({ [key]: e.currentTarget.value })} />
  );
  return (
    <>
      {need.survey && select("Survey", surveysOf(payload).map((s) => ({ value: s.obs_id, label: s.label })), view.survey, "survey")}
      {need.question && select("Question", questionsOf(payload).map((q) => ({ value: q, label: q })), view.question, "question")}
      {need.party && select("Party", partiesOf(payload).map((p) => ({ value: p, label: p })), view.party, "party")}
    </>
  );
}
