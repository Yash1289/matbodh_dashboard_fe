import { colorsTuple, createTheme, type CSSVariablesResolver } from "@mantine/core";
import type { Unit } from "./api/types";
import { formatDelta } from "./cells/format";

/** Design tokens from Frame A of the Figma file. The only place colours are written as literals. */
export const tokens = {
  color: {
    text: "#1c1f24",
    muted: "#6b7380",
    border: "#dbdee3",
    headerBg: "#f4f4f6",
    chipBorder: "#d6d9de",
    primary: "#2663eb",
    primarySoft: "#e5edff",
    gain: "#0d804d",
    loss: "#bf3333",
    white: "#ffffff",
    page: "#f6f7f9",
  },
  font: {
    family: 'Inter, "Segoe UI", system-ui, sans-serif',
    pageTitle: 22, cardTitle: 17, subtitle: 12, tableHeader: 12.5, headerSub: 11, rowLabel: 13,
    composite: 16, delta: 12, subLine: 11.5, chip: 12, button: 13, nav: 13, navSection: 11, pill: 13,
  },
  radius: { card: 10, pill: 8, strip: 8, chip: 14, button: 6, nav: 6 },
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
