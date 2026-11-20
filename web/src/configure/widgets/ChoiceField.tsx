import { Checkbox, NativeSelect, TextInput } from "@mantine/core";
import { Fragment, useState } from "react";
import { useOptions } from "../../api/queries";
import type { OptionItem } from "../../api/types";
import { asParams, grouped, markedLabel, selectData, type WidgetProps } from "./types";
import { rowProps, Well } from "./Well";
import styles from "./wells.module.css";

/**
 * One widget for every pick-from-a-list field: fixed choices, or an option list from the backend
 * (scenarios, metrics, parties, fields). Single values use a select; several use checkboxes.
 */
export function ChoiceField({ field, value, onChange, draft, ctx, error }: WidgetProps) {
  const [search, setSearch] = useState("");
  const fetched = useOptions(field.options?.source ?? "", asParams(field), draft, field.options ? ctx : null);
  const items: OptionItem[] = field.choices
    ? field.choices.map((c) => ({ value: c, label: c, kind: null, recalled: false, disabled_reason: null }))
    : fetched.data ?? [];
  // Only once the list is known: before that every chosen value would look "no longer available".
  const known = field.choices !== undefined || fetched.isSuccess;
  const offered = new Set(items.map((o) => o.value));
  const stale = (v: string) => known && !offered.has(v);

  if (field.multiple) {
    const chosen = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (v: string) =>
      onChange(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]);
    const needle = search.trim().toLowerCase();
    const shown = needle === "" ? items : items.filter((o) => o.label.toLowerCase().includes(needle) || chosen.includes(o.value));
    const staleChosen = chosen.filter(stale);
    return (
      <Well title={field.label} hint={field.help} badge={chosen.length > 0 ? `${chosen.length} selected` : null}>
        {items.length > 8 && (
          <TextInput className={styles.search} size="xs" aria-label={`Search ${field.label}`} placeholder={`Search ${field.label.toLowerCase()}…`}
            value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        )}
        <div className={`${styles.options} ${styles.optionsTall}`}>
          {grouped(shown).map((g) => (
            <Fragment key={g.heading ?? "all"}>
              {g.heading !== null && <p className={styles.group}>{g.heading}</p>}
              {g.items.map((o) => (
                <div key={o.value} className={styles.option} data-selected={chosen.includes(o.value)}>
                  <Checkbox size="sm" label={markedLabel(o)} checked={chosen.includes(o.value)}
                    disabled={o.disabled_reason !== null && !chosen.includes(o.value)} onChange={() => toggle(o.value)} />
                </div>
              ))}
            </Fragment>
          ))}
          {staleChosen.map((v) => (
            <div key={v} className={styles.option} data-selected="true">
              <Checkbox size="sm" label={`${v} (no longer available)`} checked onChange={() => toggle(v)} />
            </div>
          ))}
          {shown.length === 0 && staleChosen.length === 0 && <p className={styles.none}>No question matches the search</p>}
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </Well>
    );
  }
  // CardConfig.scenarios is a list even where a card takes one question; a bare string there fails the backend's validation.
  const asList = field.path === "scenarios";
  const current = asList ? (Array.isArray(value) && typeof value[0] === "string" ? value[0] : "") : typeof value === "string" ? value : "";
  const blank = field.default === undefined || field.default === null;
  return (
    <NativeSelect {...rowProps} label={field.label} description={field.help} error={error} value={current}
      onChange={(e) => {
        const picked = e.currentTarget.value;
        onChange(picked === "" ? undefined : asList ? [picked] : picked);
      }}
      data={[...(blank ? [{ value: "", label: "—" }] : []),
        ...selectData(items),
        ...(current !== "" && stale(current) ? [{ value: current, label: `${current} (no longer available)` }] : [])]} />
  );
}
