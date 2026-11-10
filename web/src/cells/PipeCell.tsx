import { Fragment } from "react";
import type { Cell, Unit } from "../api/types";
import { tokens } from "../theme";
import { formatValue, nullReason } from "./format";
import { Dash } from "./pieces";

interface Props {
  values: (number | null)[];
  unit: Unit;
  /** One label per round, aligned with `values`; used for assistive technology. */
  labels: string[];
  /** One flag list per round, aligned with `values`; explains a missing value. */
  flags: string[][];
}

const reasonFor = (flags: string[]): string =>
  nullReason({ value: null, delta: null, trend: [], secondary: null, flags, base: null } satisfies Cell);

/** Trend cell: one value per round, separated by thin rules. Never shows a delta. */
export function PipeCell({ values, unit, labels, flags }: Props) {
  return (
    <div role="group" style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      {values.map((value, i) => {
        const label = labels[i] ?? `Round ${i + 1}`;
        const missing = value === null;
        const reason = missing ? reasonFor(flags[i] ?? []) : "";
        return (
          <Fragment key={i}>
            {i > 0 && <span data-separator aria-hidden style={{ alignSelf: "stretch", width: 1, background: "var(--mb-border)" }} />}
            <span
              data-segment
              aria-label={`${label}: ${missing ? reason : formatValue(value, unit)}`}
              style={{ fontSize: tokens.font.composite, fontWeight: 600, color: "var(--mb-text)", fontVariantNumeric: "tabular-nums" }}
            >
              {missing ? <Dash title={reason} /> : formatValue(value, unit)}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
