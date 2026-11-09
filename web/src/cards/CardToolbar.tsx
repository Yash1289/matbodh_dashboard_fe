import { Button, Group, Menu, NativeSelect, SegmentedControl } from "@mantine/core";
import type { Density } from "../api/types";
import type { ShowPreset } from "../cells/parts";
import type { FormatRule } from "../table/formatRules";
import type { Header, SortSpec } from "../table/grid";

type Within = Extract<FormatRule, { kind: "heat" }>["within"];
export interface View {
  preset: ShowPreset;
  density: Density;
  transposed: boolean;
  format: FormatRule["kind"];
  within: Within;
  sort: SortSpec | null;
}

export const ruleOf = (v: View): FormatRule => (v.format === "none" ? { kind: "none" } : { kind: v.format, within: v.within });

interface Props {
  view: View;
  onView: (patch: Partial<View>) => void;
  columns: Header[];
  onMethod: () => void;
  onExport: () => void;
  onRefresh: () => void;
}

const PRESETS = [
  { value: "share", label: "Share" }, { value: "delta", label: "Δ only" },
  { value: "both", label: "Both" }, { value: "both_trend", label: "Both + trend" },
];
const DENSITIES = [{ value: "compact", label: "Compact" }, { value: "standard", label: "Standard" }, { value: "detailed", label: "Detailed" }];
const FORMATS = [{ value: "none", label: "None" }, { value: "heat", label: "Heat on value" }, { value: "diverging", label: "Diverging on Δ" }];
// Default "column": a scoreboard mixes pct and seats columns, which must not share one scale.
const SCOPES = [{ value: "column", label: "Within column" }, { value: "row", label: "Within row" }, { value: "table", label: "Within all columns" }];

/** Display-only controls: none of them triggers a request. */
export function CardToolbar({ view, onView, columns, onMethod, onExport, onRefresh }: Props) {
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
    <Group gap="xs" wrap="wrap">
      <SegmentedControl size="xs" aria-label="Show" data={PRESETS} value={view.preset}
        onChange={(v) => onView({ preset: v as ShowPreset })} />
      <SegmentedControl size="xs" aria-label="Density" data={DENSITIES} value={view.density}
        onChange={(v) => onView({ density: v as Density })} />
      <Button size="xs" variant={view.transposed ? "filled" : "default"} aria-pressed={view.transposed}
        onClick={() => onView({ transposed: !view.transposed, sort: null })}>⇄ Transpose</Button>
      <NativeSelect size="xs" aria-label="Format" data={FORMATS} value={view.format}
        onChange={(e) => onView({ format: e.currentTarget.value as View["format"] })} />
      <NativeSelect size="xs" aria-label="Format scope" data={SCOPES} value={view.within}
        onChange={(e) => onView({ within: e.currentTarget.value as Within })} />
      <NativeSelect size="xs" aria-label="Sort by Δ" data={sortOptions} value={sortValue}
        onChange={(e) => setSort(e.currentTarget.value)} />
      <Menu position="bottom-end">
        <Menu.Target>
          <Button size="xs" variant="default">⋯</Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={onMethod}>How this was calculated</Menu.Item>
          <Menu.Item onClick={onExport}>Export CSV</Menu.Item>
          <Menu.Item onClick={onRefresh}>Refresh</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
