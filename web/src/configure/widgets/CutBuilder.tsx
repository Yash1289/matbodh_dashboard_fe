import { Button, Checkbox, NativeSelect } from "@mantine/core";
import { Fragment } from "react";
import { useOptions } from "../../api/queries";
import { asParams, selectData, type WidgetProps } from "./types";
import { Well } from "./Well";
import styles from "./wells.module.css";

const name = (cut: string[]) => (cut.length === 0 ? "Overall" : cut.join(" × "));

/** Independent cuts (each its own table); fields within one cut are crossed. The empty cut is Overall. */
export function CutBuilder({ field, value, onChange, draft, ctx, error }: WidgetProps) {
  const options = useOptions(field.options?.source ?? "fields", asParams(field), draft, ctx);
  const cuts = Array.isArray(value) ? (value as string[][]) : [];
  const fields = options.data ?? [];
  const overall = cuts.some((c) => c.length === 0);
  const pickable = fields.filter((o) => o.disabled_reason === null);
  const scopeOf = (name: string) => fields.find((o) => o.value === name)?.scope ?? null;
  const set = (next: string[][]) => onChange(next);
  const tables = cuts.length;

  return (
    <Well title={field.label} hint={field.help} badge={tables > 0 ? `${tables} table${tables === 1 ? "" : "s"}` : null}>
      <div className={styles.option} data-selected={overall}>
        <Checkbox size="sm" label="Overall" checked={overall}
          onChange={() => set(overall ? cuts.filter((c) => c.length > 0) : [[], ...cuts])} />
      </div>
      {cuts.map((cut, i) => (cut.length === 0 ? null : (
        <Fragment key={name(cut)}>
          <div className={styles.item}>
            <div className={styles.itemHead}>
              <span className={styles.itemName}>{name(cut)}</span>
              <NativeSelect size="xs" aria-label={`Cross ${name(cut)} with`} value=""
                onChange={(e) => e.currentTarget.value && set(cuts.map((c, j) => (j === i ? [...c, e.currentTarget.value] : c)))}
                data={[{ value: "", label: "Cross with…" }, ...selectData(pickable.filter((o) => !cut.includes(o.value)))]} />
              <Button size="compact-sm" variant="subtle" color="gray" aria-label={`Remove cut ${name(cut)}`}
                onClick={() => set(cuts.filter((_, j) => j !== i))}>Remove</Button>
            </div>
            {cut.length >= 2 && scopeOf(cut[0]) === "seat" && (
              <p className={styles.note} role="note">
                {cut[0]} is a seat field: the card shows one {cut[0].replace(/_/g, " ")} at a time, with the other fields for it.
              </p>
            )}
          </div>
        </Fragment>
      )))}
      <NativeSelect size="sm" label="Add a cut" value=""
        onChange={(e) => e.currentTarget.value && set([...cuts, [e.currentTarget.value]])}
        data={[{ value: "", label: "Choose a field…" }, ...selectData(fields)]} />
      {error && <p className={styles.error}>{error}</p>}
    </Well>
  );
}
