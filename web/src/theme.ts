import { colorsTuple, createTheme, type CSSVariablesResolver } from "@mantine/core";
import type { Unit } from "./api/types";
import { formatDelta } from "./cells/format";

/** Design tokens from Frame A of the Figma file. The only place colours are written as literals. */
export const tokens = {
  color: {
    text: "#1c1f24",
    muted: "#5b6472",
    faint: "#8a919c",
    border: "#dfe2e7",
    headerBg: "#f6f7f9",
    chipBorder: "#d6d9de",
    primary: "#2663eb",
    primarySoft: "#eaf0ff",
    ink: "#1b4fc2",
    softLine: "#c4d4f8",
    gain: "#0a6c41",
    gainTint: "#ecf5f1",
    loss: "#b42d2d",
    lossTint: "#f9eded",
    white: "#ffffff",
    page: "#f1f2f5",
  },
  font: {
    family: 'Inter, "Segoe UI", system-ui, sans-serif',
    pageTitle: 24, cardTitle: 17, subtitle: 12, tableHeader: 12.5, headerSub: 11, rowLabel: 13,
    composite: 16, delta: 12, subLine: 11.5, chip: 12, button: 13, nav: 13, navSection: 11, pill: 13, brand: 17,
  },
  radius: { card: 10, pill: 8, strip: 8, chip: 14, button: 6, nav: 6 },
  /** Three elevations with different jobs, and the one focus style every control shares. */
  elevation: {
    card: "0 1px 2px #1c1f240d, 0 4px 14px -6px #1c1f2420",
    popover: "0 2px 4px #1c1f2412, 0 14px 30px -10px #1c1f2438",
    panel: "0 1px 2px #1c1f240d, 0 12px 32px -12px #1c1f2438",
    lift: "0 1px 2px #1c1f2418",
  },
  focusRing: "0 0 0 3px #2663eb40",
  layout: { topBar: 62, nav: 220, content: 1220, contentPad: 28, gap: 18 },
} as const;

export const theme = createTheme({
  fontFamily: tokens.font.family,
  primaryColor: "mb",
  colors: { mb: colorsTuple(tokens.color.primary) },
  primaryShade: 6,
  defaultRadius: tokens.radius.button,
  black: tokens.color.text,
});

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    "--mb-text": tokens.color.text,
    "--mb-muted": tokens.color.muted,
    "--mb-border": tokens.color.border,
    "--mb-header-bg": tokens.color.headerBg,
    "--mb-chip-border": tokens.color.chipBorder,
    "--mb-primary": tokens.color.primary,
    "--mb-primary-soft": tokens.color.primarySoft,
    "--mb-gain": tokens.color.gain,
    "--mb-loss": tokens.color.loss,
    "--mb-page": tokens.color.page,
    "--mb-surface": tokens.color.white,
    "--mb-ink": tokens.color.ink,
    "--mb-soft-line": tokens.color.softLine,
    "--mb-faint": tokens.color.faint,
    "--mb-gain-tint": tokens.color.gainTint,
    "--mb-loss-tint": tokens.color.lossTint,
    "--mb-ring": tokens.focusRing,
    "--mb-elev-card": tokens.elevation.card,
    "--mb-elev-pop": tokens.elevation.popover,
    "--mb-elev-panel": tokens.elevation.panel,
    "--mb-lift": tokens.elevation.lift,
  },
  light: {},
  dark: {},
});

/** Colour class of a delta; a delta that displays as zero (or is missing) is neutral. */
export function deltaTone(delta: number | null, unit: Unit = "pct"): "gain" | "loss" | "neutral" {
  if (delta === null) return "neutral";
  const text = formatDelta(delta, unit);
  return text.startsWith("▲") ? "gain" : text.startsWith("▼") ? "loss" : "neutral";
}
