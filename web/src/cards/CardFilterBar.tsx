import { Group, SegmentedControl } from "@mantine/core";
import type { FilterSpec, SlicerSpec } from "../api/types";
import { PopoverChip } from "./CardToolbar";

export type { FilterSpec, SlicerSpec };

export interface CardFilterBarProps {
  slicers?: SlicerSpec[];
  onSlicerChange?: (dimension: string, value: string) => void;
  filters?: FilterSpec[];
  onFilterChange?: (filterId: string, value: string) => void;
}

/**
 * Filter bar rendering promoted spatial slicers (e.g. Zone: All Zones ▾)
 * and seat-attribute filters (e.g. Reservation: All ▾).
 */
export function CardFilterBar({
  slicers = [],
  onSlicerChange,
  filters = [],
  onFilterChange,
}: CardFilterBarProps) {
  if (slicers.length === 0 && filters.length === 0) {
    return null;
  }

  return (
    <Group gap={8} wrap="wrap">
      {slicers.map((slicer) => {
        const defaultVal = slicer.options[0] ?? "All";
        const isSelected = slicer.selected !== defaultVal && slicer.selected !== "All";
        const label = `${slicer.label}: ${slicer.selected} ▾`;
        return (
          <PopoverChip key={slicer.dimension} label={label} selected={isSelected}>
            <SegmentedControl
              size="xs"
              aria-label={slicer.label}
              orientation={slicer.options.length > 4 ? "vertical" : "horizontal"}
              data={slicer.options.map((opt) => ({ value: opt, label: opt }))}
              value={slicer.selected}
              onChange={(val) => onSlicerChange?.(slicer.dimension, val)}
            />
          </PopoverChip>
        );
      })}

      {filters.map((filter) => {
        const defaultVal = filter.options[0] ?? "All";
        const currentVal = filter.selected ?? defaultVal;
        const isSelected = Boolean(filter.selected && filter.selected !== defaultVal && filter.selected !== "All");
        const label = `${filter.label}: ${currentVal} ▾`;
        return (
          <PopoverChip key={filter.id} label={label} selected={isSelected}>
            <SegmentedControl
              size="xs"
              aria-label={filter.label}
              orientation={filter.options.length > 4 ? "vertical" : "horizontal"}
              data={filter.options.map((opt) => ({ value: opt, label: opt }))}
              value={currentVal}
              onChange={(val) => onFilterChange?.(filter.id, val)}
            />
          </PopoverChip>
        );
      })}
    </Group>
  );
}
