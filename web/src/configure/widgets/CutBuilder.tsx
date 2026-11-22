import { Button, Checkbox, NativeSelect } from "@mantine/core";
import { useOptions } from "../../api/queries";
import { readCuts, writeCuts, type CutItem, type CutModel } from "../cutModel";
import { asParams, selectData, type WidgetProps } from "./types";
import { Well, rowProps } from "./Well";
import styles from "./wells.module.css";

const itemName = (item: CutItem) => item.fields.join(item.nested ? " › " : " × ");
const tablesOf = (item: CutItem) =>
  writeCuts({ seat: null, overall: false, items: [item] }).map((t) => t.join(" × ")).join(", ");

/**
 * Split by: View by a seat attribute (every table is read one value of it at a time), Overall, and a list of
 * splits. A split crossed further becomes one nested item that reads its parent tables too, so Cascaded can draw
 * them as a tree. A seat field is never crossed.
 */
export function CutBuilder({ field, value, onChange, draft, ctx, error }: WidgetProps) {
  const options = useOptions(field.options?.source ?? "fields", asParams(field), draft, ctx);
  const fields = options.data ?? [];
  const pickable = fields.filter((o) => o.disabled_reason === null);
  const isSeat = (name: string) => fields.find((o) => o.value === name)?.scope === "seat";
  const model = readCuts(Array.isArray(value) ? (value as string[][]) : [], isSeat);
  const commit = (next: CutModel) => onChange(writeCuts(next));
  const tables = writeCuts(model);
  const seatFields = pickable.filter((o) => o.scope === "seat");
  // A choice is offered only when it adds a table the card does not already read.
  const adds = (items: CutItem[]) => writeCuts({ ...model, items }).length > tables.length;
  const withItem = (item: CutItem, at?: number) =>
    at === undefined ? [...model.items, item] : model.items.map((x, i) => (i === at ? item : x));
  const splittable = (model.seat === null ? pickable : pickable.filter((o) => o.scope !== "seat"));
  const seatChoices = [
    { value: "", label: "All seats together" },
    ...seatFields.map((o) => ({ value: o.value, label: o.label })),
    ...(model.seat !== null && !seatFields.some((o) => o.value === model.seat) ? [{ value: model.seat, label: model.seat }] : []),
  ];

  return (
    <Well title={field.label} hint={field.help} badge={tables.length > 0 ? `${tables.length} table${tables.length === 1 ? "" : "s"}` : null}>
      {seatFields.length > 0 && (
        <NativeSelect {...rowProps} label="View by seat" value={model.seat ?? ""} data={seatChoices}
          description={model.seat ? `One ${model.seat.replace(/_/g, " ")} at a time; you choose which on the card.` : undefined}
          onChange={(e) => {
            const seat = e.currentTarget.value || null;
            commit({ ...model, seat, items: seat === null ? model.items : model.items.filter((i) => !i.fields.some(isSeat)) });
          }} />
      )}
      <div className={styles.option} data-selected={model.overall}>
        <Checkbox size="sm" label="Overall" checked={model.overall} onChange={() => commit({ ...model, overall: !model.overall })} />
      </div>
      {model.items.map((item, i) => {
        const crossable = (item.fields.length === 1 || item.nested) && !item.fields.some(isSeat);
        const name = itemName(item);
        return (
          <div className={styles.item} key={i}>
            <div className={styles.itemHead}>
              <span className={styles.itemName}>{name}</span>
              {crossable && (
                <NativeSelect size="xs" aria-label={`Then split ${name} by`} value=""
                  onChange={(e) => e.currentTarget.value && commit({ ...model, items: withItem({ fields: [...item.fields, e.currentTarget.value], nested: true }, i) })}
                  data={[{ value: "", label: "Then split by…" }, ...selectData(pickable.filter((o) => o.scope !== "seat" && !item.fields.includes(o.value)
                    && adds(withItem({ fields: [...item.fields, o.value], nested: true }, i))))]} />
              )}
              <Button size="compact-sm" variant="subtle" color="gray" aria-label={`Remove ${name}`}
                onClick={() => commit({ ...model, items: model.items.filter((_, j) => j !== i) })}>Remove</Button>
            </div>
            {item.nested && item.fields.length > 1 && <p className={styles.tables}>Reads {tablesOf(item)}</p>}
          </div>
        );
      })}
      {model.items.length === 0 && <p className={styles.none}>Add a split to break the table down, for example by age group or gender.</p>}
      <NativeSelect size="sm" label="Add a split" value=""
        onChange={(e) => e.currentTarget.value && commit({ ...model, items: withItem({ fields: [e.currentTarget.value], nested: false }) })}
        data={[{ value: "", label: "Choose a field…" }, ...selectData(splittable.filter((o) => adds(withItem({ fields: [o.value], nested: false }))))]} />
      {error && <p className={styles.error}>{error}</p>}
    </Well>
  );
}
