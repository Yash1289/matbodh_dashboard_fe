---
name: MatBodh Dashboard
description: A calm analyst's desk for survey rounds: ink frame, quiet neutrals, one blue for action.
colors:
  primary: "#2663eb"
  primary-soft: "#eaf0ff"
  primary-ink: "#1b4fc2"
  soft-line: "#c4d4f8"
  deep-ink: "#16213a"
  accent-amber: "#b85c0a"
  accent-amber-soft: "#fdf1e4"
  saffron: "#f4a259"
  mint: "#8fe3b5"
  sky: "#a9c1ff"
  text: "#1c1f24"
  muted: "#5b6472"
  faint: "#8a919c"
  border: "#dfe2e7"
  chip-border: "#d6d9de"
  header-bg: "#f6f7f9"
  page: "#f1f2f5"
  surface: "#ffffff"
  gain: "#0a6c41"
  gain-tint: "#ecf5f1"
  loss: "#b42d2d"
  loss-tint: "#f9eded"
typography:
  page-title:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
  card-title:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
  composite:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
  body:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
rounded:
  button: "6px"
  pill: "8px"
  card: "10px"
  chip: "14px"
spacing:
  gap: "18px"
  content-pad: "28px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
    padding: "8px 16px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.chip}"
    padding: "5px 10px"
  chip-selected:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.chip}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
---

# Design System: MatBodh Dashboard

## Overview

**Creative North Star: "The Analyst's Desk"**

A calm, well-lit working surface. The page is a quiet cool grey; cards are white sheets laid on it; a deep ink frame (top bar, the first-screen mark) gives the product its identity. Blue is for the one thing you can act on, saffron marks the thing in focus (the state), mint marks change, sky marks the data version. Nothing decorates: every mark says what the data is.

Density is working density: 13px tables, 16px composite values, tabular numerals. Depth is layered and quiet: hairline borders and soft ambient shadows, never heavy.

**Key Characteristics:**
- Cool neutrals, one blue accent, ink for identity.
- Tabular, scannable numbers; the measure is always named.
- Missing values are a dash, not a zero.
- Depth by tone and hairline first, shadow second.

## Colors

Cool paper neutrals with a single saturated blue and a deep ink identity.

### Primary
- **Analyst Blue** (#2663eb): primary actions, selection, focus ring base. **Ink Blue** (#1b4fc2) is its text-on-soft form; **Pale Blue** (#eaf0ff) is selected and chip fills; **Soft Line** (#c4d4f8) outlines selected chips.

### Secondary
- **Deep Ink** (#16213a): the top bar, the mark and first-screen titles; the product's identity.
- **Burnt Amber** (#b85c0a) with **Amber Mist** (#fdf1e4): progress on the first screen; used sparingly.

### Tertiary
- **Saffron** (#f4a259), **Mint** (#8fe3b5), **Sky** (#a9c1ff): only on the ink bar, as context chips (state, change, data version).

### Neutral
- **Ink Text** (#1c1f24), **Slate Muted** (#5b6472), **Faint** (#8a919c) for text; **Hairline** (#dfe2e7) and **Chip Hairline** (#d6d9de) for borders; **Header Wash** (#f6f7f9) for table headers; **Page Grey** (#f1f2f5); **Surface** (#ffffff).
- **Gain** (#0a6c41) / **Loss** (#b42d2d) with their tints carry change in value only.

### Named Rules
**The One Blue Rule.** Blue means "you can act here" or "this is selected". It is never decoration.
**The Ink Frame Rule.** Saffron, mint and sky live only on the ink bar and the first-screen mark.

## Typography

**Display / Body Font:** Inter (with Segoe UI, system-ui)

**Character:** One family, weight and size do the work; numerals are tabular.

### Hierarchy
- **Page title** (700, 24px): page and tab headings. **Card title** (700, 17px). **Composite value** (600, 16px): the number in a cell. **Body / table** (400–500, 13px). **Label** (600, 12px): chips, sub-lines, units.
- First-screen titles are larger (34px) and scale with the container.

### Named Rules
**The Name-the-Measure Rule.** A number is never shown without its measure, round and party or question.

## Layout

A fixed 220px sidebar and a 62px ink top bar; content up to 1220px with 28px padding and 18px gaps; cards sit on a draggable column canvas. The first screen (state, level, rounds) is a page, not a dialog, and answers to its own container width.

## Elevation & Depth

Layered and quiet: hairline borders plus ambient shadows. Card `0 1px 2px #1c1f240d, 0 4px 14px -6px #1c1f2420`; popover `0 2px 4px #1c1f2412, 0 14px 30px -10px #1c1f2438`; panel `0 1px 2px #1c1f240d, 0 12px 32px -12px #1c1f2438`. One focus style everywhere: `0 0 0 3px #2663eb40`.

### Named Rules
**The Quiet Depth Rule.** Shadows are soft and offset; no hard or coloured halos.

## Shapes

Gently rounded: buttons 6px, pills 8px, cards 10px, chips 14px. Hairline 1px borders define surfaces.

## Components

### Buttons
- **Shape:** 6px radius. **Primary:** Analyst Blue fill, white text. **Secondary:** white with hairline border. Visible 3px focus ring.

### Chips
- **Style:** white, chip hairline, 14px radius, 12px text. **Selected:** Pale Blue fill, Ink Blue text, a small changed-from-default dot. Popover chips (Lens, Format, Sort, Party, Survey, Question) open a vertical option list.

### Cards / Containers
- **Corner style:** 10px. **Background:** white on Page Grey. **Shadow:** card elevation. **Padding:** 14–18px.

### Tables (signature)
- Header Wash header row, 13px labels, tabular numerals, composite cells (value left, change right), dash for missing values with the reason on hover.

## Do's and Don'ts

### Do:
- **Do** name the measure, round and party or question beside every number.
- **Do** show a dash for missing values.
- **Do** keep blue for actions and selection only.
- **Do** use placeholders ("xx%") in any decorative or onboarding illustration.

### Don't:
- **Don't** show real survey figures in decoration.
- **Don't** use "pp" in any label; values are percentages.
- **Don't** use hard offset shadows or coloured glows.
- **Don't** put saffron, mint or sky outside the ink frame and first-screen mark.
