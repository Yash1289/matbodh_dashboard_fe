import { Button, Checkbox, Group, Menu, NativeSelect, SegmentedControl, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import type { ReactNode } from "react";
import type { Density, GridPayload } from "../api/types";
import type { ShowPreset } from "../cells/parts";
import type { SortSpec } from "../table/grid";
import { tokens } from "../theme";
import { PopoverChip, chipStyle } from "./PopoverChip";
import { cutLabel, initialView, type FamilyView, type Within } from "./view";

interface Props {
  payload: GridPayload;
  view: FamilyView;
  onView: (patch: Partial<FamilyView>) => void;
  onMethod: () => void;
  onExport: () => void;
  canExport: boolean;
  onRefresh: () => void;
  /** Collapse the secondary controls into a +n menu (set from the container width). */
  narrow?: boolean;
}

interface Control {
  id: string;
  label: string;
  selected: boolean;
  primary: boolean;
  content?: ReactNode;
  toggle?: { pressed: boolean; onToggle: () => void };
}

const PRESET_LABELS: Record<ShowPreset, string> = {
  share: "Values", delta: "Δ only", both: "Values + Δ", both_trend: "Values + trend",
};
// Only compare cards have parts to choose between: a trend cell already is its per-round values.
const PRESETS_BY_MODE: Record<string, ShowPreset[]> = {
  compare: ["share", "delta", "both"],
};
const DENSITIES: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" }, { value: "standard", label: "Standard" }, { value: "detailed", label: "Detailed" },
];
const SCOPES: { value: Within; label: string }[] = [
  { value: "column", label: "Within column" }, { value: "row", label: "Within row" }, { value: "table", label: "Within all columns" },
];

const labelOf = <T extends { value: string; label: string }>(options: T[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;

/** Display-only controls: none of them triggers a request. Which ones show comes from the payload. */
export function ControlStrip({ payload, view, onView, onMethod, onExport, canExport, onRefresh, narrow = false }: Props) {
  const initial = initialView(payload);
  const { meta, mode } = payload;
  const caps = meta.capabilities;
  const lens = meta.lenses.find((l) => l.id === view.lens) ?? meta.lenses.find((l) => l.id === meta.default_lens);
  const columns = payload.columns.filter((c) => c.lenses === null || c.lenses.includes(lens?.id ?? view.lens));
  const deltaSort = mode === "compare";
  const controls: Control[] = [];

  if (meta.lenses.length > 1) {
    controls.push({
      id: "lens", primary: true, label: `Lens: ${lens?.label ?? view.lens} ▾`,
      selected: view.lens !== initial.lens,
      content: (
        <SegmentedControl size="xs" aria-label="Lens" orientation={meta.lenses.length > 4 ? "vertical" : "horizontal"}
          data={meta.lenses.map((l) => ({ value: l.id, label: l.label }))} value={lens?.id ?? view.lens}
          onChange={(v) => onView({ lens: v })} />
      ),
    });
  }

  const divergingOk = mode === "compare" || lens?.unit === "percentage_points";
  const formats = [
    { value: "none", label: "None" }, { value: "heat", label: "Heat on value" },
    ...(divergingOk ? [{ value: "diverging", label: mode === "compare" ? "Diverging on Δ" : "Diverging on value" }] : []),
  ];
  controls.push({
    id: "format", primary: true, label: "Format ▾",
    selected: view.format !== initial.format || view.within !== initial.within,
    content: (
      <Stack gap="xs">
        <SegmentedControl size="xs" aria-label="Format" data={formats} value={view.format}
          onChange={(v) => onView({ format: v as FamilyView["format"] })} />
        <NativeSelect size="xs" aria-label="Format scope" data={SCOPES} value={view.within}
          onChange={(e) => onView({ within: e.currentTarget.value as Within })} />
      </Stack>
    ),
  });

  if (caps.sort) {
    const part: SortSpec["part"] = deltaSort ? "delta" : "value";
    const current = view.sort ? `${view.sort.dir}:${view.sort.part}:${view.sort.column}` : "";
    const options = [
      { value: "", label: deltaSort ? "No Δ sort" : "No sort" },
      ...columns.flatMap((c) => [
        { value: `desc:${part}:${c.key}`, label: `${deltaSort ? "Δ " : ""}${c.label} high to low` },
        { value: `asc:${part}:${c.key}`, label: `${deltaSort ? "Δ " : ""}${c.label} low to high` },
      ]),
    ];
    controls.push({
      id: "sort", primary: true, label: "Sort ▾", selected: view.sort !== null,
      content: (
        <NativeSelect size="xs" aria-label="Sort" data={options} value={current}
          onChange={(e) => {
            const [dir, sortPart, ...rest] = e.currentTarget.value.split(":");
            onView({ sort: e.currentTarget.value === "" ? null : { column: rest.join(":"), part: sortPart as SortSpec["part"], dir: dir as SortSpec["dir"] } });
          }} />
      ),
    });
  }

  const presets = PRESETS_BY_MODE[mode];
  if (presets) {
    controls.push({
      id: "cell", primary: false, label: `Cell: ${PRESET_LABELS[view.preset]} ▾`, selected: view.preset !== initial.preset,
      content: (
        <SegmentedControl size="xs" aria-label="Cell parts" data={presets.map((p) => ({ value: p, label: PRESET_LABELS[p] }))}
          value={view.preset} onChange={(v) => onView({ preset: v as ShowPreset })} />
      ),
    });
  }

  controls.push({
    id: "density", primary: false, label: `Density: ${labelOf(DENSITIES, view.density)} ▾`, selected: view.density !== initial.density,
    content: <SegmentedControl size="xs" aria-label="Density" data={DENSITIES} value={view.density} onChange={(v) => onView({ density: v as Density })} />,
  });

  if (caps.details) {
    controls.push({
      id: "details", primary: false, label: "Details", selected: view.showDetails,
      toggle: { pressed: view.showDetails, onToggle: () => onView({ showDetails: !view.showDetails }) },
    });
  }
  if (caps.transpose) {
    controls.push({
      id: "transpose", primary: false, label: "⇄ Transpose", selected: view.transposed,
      toggle: { pressed: view.transposed, onToggle: () => onView({ transposed: !view.transposed, sort: null }) },
    });
  }

  controls.push({
    id: "find", primary: false, label: view.hidden.length ? `Find & hide (${view.hidden.length}) ▾` : "Find & hide ▾",
    selected: view.search !== "" || view.hidden.length > 0,
    content: (
      <Stack gap="xs">
        <TextInput size="xs" aria-label="Search rows" placeholder="Search rows" value={view.search}
          onChange={(e) => onView({ search: e.currentTarget.value })} />
        {columns.map((c) => (
          <Checkbox key={c.key} size="xs" label={c.label} checked={!view.hidden.includes(c.key)}
            onChange={(e) => onView({ hidden: e.currentTarget.checked ? view.hidden.filter((k) => k !== c.key) : [...view.hidden, c.key] })} />
        ))}
      </Stack>
    ),
  });

  const draw = (c: Control) =>
    c.toggle ? (
      <UnstyledButton key={c.id} style={chipStyle(c.toggle.pressed)} aria-pressed={c.toggle.pressed} onClick={c.toggle.onToggle}>{c.label}</UnstyledButton>
    ) : (
      <PopoverChip key={c.id} label={c.label} selected={c.selected}>{c.content}</PopoverChip>
    );
  const primary = controls.filter((c) => c.primary);
  const secondary = controls.filter((c) => !c.primary);

  return (
    <Group gap={8} wrap="wrap" justify="flex-end">
      {payload.cuts.length > 1 && (
        <SegmentedControl size="xs" aria-label="Cut" value={view.cut}
          data={payload.cuts.map((c) => ({ value: c.id, label: cutLabel(c.dimensions) }))}
          onChange={(v) => onView({ cut: v })} />
      )}
      {primary.map(draw)}
      {narrow
        ? secondary.length > 0 && (
          <PopoverChip label={`+${secondary.length}`} selected={secondary.some((c) => c.selected)}>
            <Stack gap="sm">
              {secondary.map((c) => (
                <div key={c.id}>
                  <Text size="xs" fw={600} mb={4}>{c.label.replace(" ▾", "")}</Text>
                  {c.toggle ? (
                    <Checkbox size="xs" label={c.label} checked={c.toggle.pressed} onChange={c.toggle.onToggle} />
                  ) : c.content}
                </div>
              ))}
            </Stack>
          </PopoverChip>
        )
        : secondary.map(draw)}
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
