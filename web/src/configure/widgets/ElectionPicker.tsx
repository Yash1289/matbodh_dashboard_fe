import { NativeSelect } from "@mantine/core";
import { useOptions } from "../../api/queries";
import type { BenchmarkReference } from "../../api/types";
import { rowProps } from "./Well";
import { asParams, optionLabel, type WidgetProps } from "./types";

const toValue = (r: BenchmarkReference | undefined): string =>
  r === undefined ? "" : r.kind === "election" ? `election:${r.year}:${r.election_type}` : r.kind;

const toReference = (v: string): BenchmarkReference | undefined => {
  if (v === "") return undefined;
  if (v === "none" || v === "compare") return { kind: v };
  const [, year, type] = v.split(":");
  return { kind: "election", year: Number(year), election_type: type as "LS" | "VS" };
};

/** Nothing, the comparison round (the default when left empty), or a past election. */
export function ElectionPicker({ field, value, onChange, draft, ctx, error }: WidgetProps) {
  const options = useOptions(field.options?.source ?? "elections", asParams(field), draft, ctx);
  return (
    <NativeSelect {...rowProps} label={field.label} description={field.help} error={error}
      value={toValue(value as BenchmarkReference | undefined)}
      onChange={(e) => onChange(toReference(e.currentTarget.value))}
      data={[{ value: "", label: "Default (the comparison round)" },
        ...(options.data ?? []).map((o) => ({ value: o.value, label: optionLabel(o), disabled: o.disabled_reason !== null }))]} />
  );
}
