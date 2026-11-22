import { Checkbox, Group, NativeSelect, SegmentedControl, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import type { ReactNode } from "react";
import type { GridDensity, GridPayload } from "../api/types";
import type { ShowPreset } from "../cells/parts";
import type { SortSpec } from "../table/grid";
import { PopoverChip, chipProps, chipStyle } from "./PopoverChip";
import type { SizeClass } from "./sizeClass";
import { ViewMenu, type ViewRow } from "./ViewMenu";
import { cascadable } from "./grid/cascade";
import { cutLabel, initialView, type FamilyView, type Within } from "./view";

interface Props {
  payload: GridPayload;
  view: FamilyView;
  onView: (patch: Partial<FamilyView>) => void;
  onMethod: () => void;
  onExport: () => void;
  canExport: boolean;
  onRefresh: () => void;
  /** Size class of the card (from its own width): decides which controls stay on the strip. */
  size: SizeClass;
  /** Drawn first on the strip: the seat selector, when the cut has one. */
  leading?: ReactNode;
  /** Fields that describe the seat: a cut starting with one is a selector, not a tree. */
  seatFields?: ReadonlySet<string>;
}

/** Tabs only on a wide card with three lenses or fewer; a chip otherwise; nothing when there is one lens or none. */
export function lensPresentation(count: number, size: SizeClass): "tabs" | "chip" | "none" {
  if (count <= 1) return "none";
  return size === "wide" && count <= 3 ? "tabs" : "chip";
}

const ON_OFF = (on: boolean) => (on ? "On" : "Off");

interface Control {
  id: string;
  /** Row title in the View menu. */
  name: string;
  /** The setting's current value, shown in the View menu. */
  value: string;
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
const DENSITIES: { value: GridDensity; label: string }[] = [
  { value: "standard", label: "Standard" }, { value: "detailed", label: "Detailed" }, { value: "cascaded", label: "Cascaded" },
];
const SCOPES: { value: Within; label: string }[] = [
  { value: "column", label: "Within column" }, { value: "row", label: "Within row" }, { value: "table", label: "Within all columns" },
];

const labelOf = <T extends { value: string; label: string }>(options: T[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;

/** Display-only controls: none of them triggers a request. Which ones show comes from the payload. */
export function ControlStrip({ payload, view, onView, onMethod, onExport, canExport, onRefresh, size, leading, seatFields }: Props) {
  const initial = initialView(payload, seatFields);
  const cascade = cascadable(payload.cuts, seatFields);
  const tree = view.density === "cascaded";
  const { meta, mode } = payload;
  const caps = meta.capabilities;
  const lens = meta.lenses.find((l) => l.id === view.lens) ?? meta.lenses.find((l) => l.id === meta.default_lens);
  const columns = payload.columns.filter((c) => c.lenses === null || c.lenses.includes(lens?.id ?? view.lens));
  const deltaSort = mode === "compare";
  const controls: Control[] = [];

  if (meta.lenses.length > 1) {
    controls.push({
      id: "lens", name: "Lens", value: lens?.label ?? view.lens, primary: true, label: `Lens: ${lens?.label ?? view.lens} ▾`,
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
    id: "format", name: "Format", value: labelOf(formats, view.format), primary: true, label: "Format ▾",
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

  // Sort options are payload columns; a transposed grid's columns are the rows, so there is nothing to offer.
  if (caps.sort && !view.transposed && !tree) {
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
      id: "sort", name: "Sort", value: view.sort ? options.find((o) => o.value === current)?.label ?? "Sorted" : "None",
      primary: true, label: "Sort ▾", selected: view.sort !== null,
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
      id: "cell", name: "Cell parts", value: PRESET_LABELS[view.preset], primary: false, label: `Cell: ${PRESET_LABELS[view.preset]} ▾`, selected: view.preset !== initial.preset,
      content: (
        <SegmentedControl size="xs" aria-label="Cell parts" data={presets.map((p) => ({ value: p, label: PRESET_LABELS[p] }))}
          value={view.preset} onChange={(v) => onView({ preset: v as ShowPreset })} />
      ),
    });
  }

  controls.push({
    id: "density", name: "Density", value: labelOf(DENSITIES, view.density), primary: false, label: `Density: ${labelOf(DENSITIES, view.density)} ▾`, selected: view.density !== initial.density,
    content: (
      <>
        <SegmentedControl size="xs" aria-label="Density" value={view.density} onChange={(v) => onView({ density: v as GridDensity })}
          data={DENSITIES.map((d) => ({ ...d, disabled: d.value === "cascaded" && !cascade.ok }))} />
        {!cascade.ok && <Text size="xs" c="dimmed" mt={4}>{cascade.reason}</Text>}
      </>
    ),
  });

  if (caps.details) {
    controls.push({
      id: "details", name: "Details", value: ON_OFF(view.showDetails), primary: false, label: "Details", selected: view.showDetails,
      toggle: { pressed: view.showDetails, onToggle: () => onView({ showDetails: !view.showDetails }) },
    });
  }
  if (caps.transpose && !tree) {
    controls.push({
      id: "transpose", name: "Transpose", value: ON_OFF(view.transposed), primary: size === "wide", label: "⇄ Transpose", selected: view.transposed,
      toggle: { pressed: view.transposed, onToggle: () => onView({ transposed: !view.transposed, sort: null }) },
    });
  }

  controls.push({
    id: "find", name: "Find & hide",
    value: view.search !== "" ? `“${view.search}”` : view.hidden.length > 0 ? `${view.hidden.length} hidden` : "None",
    primary: false, label: view.hidden.length ? `Find & hide (${view.hidden.length}) ▾` : "Find & hide ▾",
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
      <UnstyledButton key={c.id} {...chipProps(c.toggle.pressed)} style={chipStyle(c.toggle.pressed)} aria-pressed={c.toggle.pressed} onClick={c.toggle.onToggle}>{c.label}</UnstyledButton>
    ) : (
      <PopoverChip key={c.id} label={c.label} selected={c.selected}>{c.content}</PopoverChip>
    );

  // The lens is outside the View menu at every size; the rest stays on the strip only on a wide card.
  const lensControl = controls.find((c) => c.id === "lens");
  const onStrip = controls.filter((c) => c.id !== "lens" && c.primary && size === "wide");
  const inView = controls.filter((c) => c.id !== "lens" && !onStrip.includes(c));
  const lensMode = lensPresentation(meta.lenses.length, size);
  const rows: ViewRow[] = inView.map((c) => ({
    id: c.id, label: c.name, value: c.value, selected: c.selected,
    node: c.toggle ? undefined : c.content, toggle: c.toggle,
  }));
  const cutChip = payload.cuts.length > 1 && !tree && (
    size === "narrow" ? (
      <PopoverChip label={`Cut: ${cutLabel(payload.cuts.find((c) => c.id === view.cut)?.dimensions ?? [])} ▾`} selected={false}>
        <SegmentedControl size="xs" aria-label="Cut" orientation="vertical" value={view.cut}
          data={payload.cuts.map((c) => ({ value: c.id, label: cutLabel(c.dimensions) }))}
          onChange={(v) => onView({ cut: v })} />
      </PopoverChip>
    ) : (
      <SegmentedControl size="xs" aria-label="Cut" value={view.cut}
        data={payload.cuts.map((c) => ({ value: c.id, label: cutLabel(c.dimensions) }))}
        onChange={(v) => onView({ cut: v })} />
    )
  );

  return (
    <Group gap={8} wrap="wrap" justify="flex-end">
      {leading}
      {cutChip}
      {lensMode === "tabs" && (
        <div role="tablist" aria-label="Lens" style={{ display: "flex", gap: 4 }}>
          {meta.lenses.map((l) => {
            const active = l.id === (lens?.id ?? view.lens);
            return (
              <UnstyledButton key={l.id} role="tab" aria-selected={active} className={chipProps(false).className}
                onClick={() => onView({ lens: l.id })}
                style={{
                  padding: "6px 10px", fontSize: 13, fontWeight: active ? 600 : 500, whiteSpace: "nowrap",
                  color: active ? "var(--mb-ink)" : "var(--mb-muted)",
                  borderBottom: `2px solid ${active ? "var(--mb-primary)" : "transparent"}`, borderRadius: "6px 6px 0 0",
                }}>
                {l.label}
              </UnstyledButton>
            );
          })}
        </div>
      )}
      {lensMode === "chip" && lensControl && draw(lensControl)}
      {onStrip.map(draw)}
      <ViewMenu rows={rows} actions={[
        { id: "method", label: "How this was calculated", onSelect: onMethod },
        { id: "export", label: "Export CSV", onSelect: onExport, disabled: !canExport },
        { id: "refresh", label: "Refresh", onSelect: onRefresh },
      ]} />
    </Group>
  );
}
