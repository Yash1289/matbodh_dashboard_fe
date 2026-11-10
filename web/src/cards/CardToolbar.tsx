import { Button, Group, Menu, NativeSelect, SegmentedControl, Stack, UnstyledButton } from "@mantine/core";
import type { Density } from "../api/types";
import type { ShowPreset } from "../cells/parts";
import type { FormatRule } from "../table/formatRules";
import type { Header, SortSpec } from "../table/grid";
import { tokens } from "../theme";
import { PopoverChip, chipStyle } from "./PopoverChip";

type Within = Extract<FormatRule, { kind: "heat" }>["within"];
export interface View {
  preset: ShowPreset;
  density: Density;
  transposed: boolean;
  format: FormatRule["kind"];
  within: Within;
  sort: SortSpec | null;
  lens?: string | null;
}

export const ruleOf = (v: View): FormatRule => (v.format === "none" ? { kind: "none" } : { kind: v.format, within: v.within });

interface Props {
  view: View;
  onView: (patch: Partial<View>) => void;
  /** The card's starting view; a chip is "selected" when its value differs from this. */
  initial: View;
  canSort: boolean;
  columns: Header[];
  onMethod: () => void;
  onExport: () => void;
  canExport: boolean;
  onRefresh: () => void;
  availableLenses?: string[];
  isGrid?: boolean;
}

const PRESETS = [
  { value: "share", label: "Share" }, { value: "delta", label: "Δ only" },
  { value: "both", label: "Both" }, { value: "both_trend", label: "Both + trend" },
];
const DENSITIES = [{ value: "compact", label: "Compact" }, { value: "standard", label: "Standard" }, { value: "detailed", label: "Detailed" }];
const FORMATS = [{ value: "none", label: "None" }, { value: "heat", label: "Heat on value" }, { value: "diverging", label: "Diverging on Δ" }];
// Default "column": a scoreboard mixes pct and seats columns, which must not share one scale.
const SCOPES = [{ value: "column", label: "Within column" }, { value: "row", label: "Within row" }, { value: "table", label: "Within all columns" }];

export const LENS_LABELS: Record<string, string> = {
  support_share: "Support %",
  contribution_share: "Contribution %",
  size_of_impact_pp: "Net Impact (pp)",
  composition_share: "Composition %",
  net_score: "Net Score",
  positive_share: "Gross Sat %",
  negative_share: "Gross Dis %",
};

// The chip primitives live in PopoverChip.tsx; re-exported until this toolbar is retired.
export { PopoverChip, chipStyle };

const labelOf = (options: { value: string; label: string }[], value: string) => options.find((o) => o.value === value)?.label ?? value;

/** Display-only controls: none of them triggers a request. */
export function CardToolbar({ view, onView, initial, canSort, columns, onMethod, onExport, canExport, onRefresh, availableLenses, isGrid = true }: Props) {
  if (!isGrid) {
    return (
      <Group gap={8} wrap="wrap" justify="flex-end">
        <Menu position="bottom-end">
          <Menu.Target>
            <Button variant="default" style={{ border: "1px solid var(--mb-chip-border)", padding: "8px 14px", fontSize: tokens.font.button, fontWeight: 500, height: "auto" }}>⋯</Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={onMethod}>How this was calculated</Menu.Item>
            <Menu.Item onClick={onExport} disabled={!canExport}>Export CSV</Menu.Item>
            <Menu.Item onClick={onRefresh}>Refresh</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    );
  }

  const sortValue = view.sort?.part === "delta" ? `${view.sort.dir}:${view.sort.column}` : "";
  const sortOptions = [
    { value: "", label: "No Δ sort" },
    ...columns.flatMap((c) => [
      { value: `desc:${c.key}`, label: `Δ ${c.label} high to low` },
      { value: `asc:${c.key}`, label: `Δ ${c.label} low to high` },
    ]),
  ];
  const setSort = (v: string) => {
    const [dir, ...rest] = v.split(":");
    onView({ sort: v === "" ? null : { column: rest.join(":"), part: "delta", dir: dir as SortSpec["dir"] } });
  };

  return (
    <Group gap={8} wrap="wrap" justify="flex-end">
      {availableLenses && availableLenses.length > 1 && (
        <PopoverChip
          label={`Lens: ${LENS_LABELS[view.lens ?? "support_share"] ?? view.lens} ▾`}
          selected={Boolean(view.lens && view.lens !== initial.lens && view.lens !== "support_share")}
        >
          <SegmentedControl
            size="xs"
            aria-label="View Lens"
            data={availableLenses.map((l) => ({ value: l, label: LENS_LABELS[l] ?? l }))}
            value={view.lens ?? "support_share"}
            onChange={(v) => onView({ lens: v })}
          />
        </PopoverChip>
      )}
      <PopoverChip label={`Cell: ${labelOf(PRESETS, view.preset)} ▾`} selected={view.preset !== initial.preset}>
        <SegmentedControl size="xs" aria-label="Show" data={PRESETS} value={view.preset}
          onChange={(v) => onView({ preset: v as ShowPreset })} />
      </PopoverChip>
      <PopoverChip label={`Density: ${labelOf(DENSITIES, view.density)} ▾`} selected={view.density !== initial.density}>
        <SegmentedControl size="xs" aria-label="Density" data={DENSITIES} value={view.density}
          onChange={(v) => onView({ density: v as Density })} />
      </PopoverChip>
      <PopoverChip label="Format ▾" selected={view.format !== initial.format || view.within !== initial.within}>
        <Stack gap="xs">
          <SegmentedControl size="xs" aria-label="Format" data={FORMATS} value={view.format}
            onChange={(v) => onView({ format: v as View["format"] })} />
          <NativeSelect size="xs" aria-label="Format scope" data={SCOPES} value={view.within}
            onChange={(e) => onView({ within: e.currentTarget.value as Within })} />
        </Stack>
      </PopoverChip>
      <UnstyledButton style={chipStyle(view.transposed)} aria-pressed={view.transposed}
        onClick={() => onView({ transposed: !view.transposed, sort: null })}>⇄ Transpose</UnstyledButton>
      {canSort && (
        <PopoverChip label="Sort ▾" selected={view.sort !== null}>
          <NativeSelect size="xs" aria-label="Sort by Δ" data={sortOptions} value={sortValue}
            onChange={(e) => setSort(e.currentTarget.value)} />
        </PopoverChip>
      )}
      <Menu position="bottom-end">
        <Menu.Target>
          <Button variant="default" style={{ border: "1px solid var(--mb-chip-border)", padding: "8px 14px", fontSize: tokens.font.button, fontWeight: 500, height: "auto" }}>⋯</Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={onMethod}>How this was calculated</Menu.Item>
          <Menu.Item onClick={onExport} disabled={!canExport}>Export CSV</Menu.Item>
          <Menu.Item onClick={onRefresh}>Refresh</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
