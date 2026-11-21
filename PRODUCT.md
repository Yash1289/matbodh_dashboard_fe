# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

MatBodh analysts working on one state at a time. They compare survey rounds and build a canvas of cards from them: party vote share, opinion, seat rankings, benchmarks, vote movement. Used on large desktop monitors (often zoomed or scaled), laptops, and occasionally a tablet. Confirmed by the owner.

## Product Purpose

A dashboard over the MatBodh survey analytics engine. The analyst chooses a state, survey level and rounds once (the context); every card reads from that context, and the canvas of cards is arranged into tabs. Success is that an analyst reaches a trustworthy answer without leaving the canvas, and can see exactly what each number is and where it came from.

## Positioning

Every number is computed by the engine (ClickHouse) and the browser only arranges and formats it. The dashboard never invents data, availability or labels: a missing value is shown as a dash, with its reason on hover.

## Operating Context

- Survey rounds belong to a state and have a level (AC, PC, zone, state-wide); a context may mix levels, and what a card offers depends on the levels it reads.
- A card can read the context's anchor and comparison rounds or its own survey(s).
- The canvas, tabs and last context are kept in the browser; the card library is shared.
- Dev and live work runs against a read-only engine: only aggregates are inspected.

## Capabilities and Constraints

- Card families: Party vote share, Opinion, Gender gap, Seat ranking, Group ranking, Seat benchmark, Vote movement.
- Values are shown as percentages; no "pp" in any name. A missing value is a dash.
- The survey data is sensitive: nothing real (numbers, party results, survey names beyond what the user already sees) may appear in marketing-style or decorative surfaces; illustrations use placeholders such as "xx%".
- Zone and state-wide rounds have no seat-level features.

## Brand Commitments

Name: MatBodh. The existing mark (bar-chart tick) and the deep ink top bar with saffron, mint and sky accents are the committed identity. Confirmed by the owner through the existing app.

## Evidence on Hand

Real survey data exists in the engine but must not be shown in decorative or onboarding surfaces. There are no testimonials, customer names or public benchmarks, and none may be invented.

## Product Principles

1. The engine owns every number; the interface never computes or invents one.
2. Say what is shown: every table names its measure, its rounds and its party or question.
3. One context, many cards: choices made once stay made.
4. Missing is a dash with a reason, never a zero or a guess.
5. Sensitive data stays out of decoration: illustrate with placeholders.

## Accessibility & Inclusion

Keyboard operable with visible focus on every control; readable at zoomed and scaled displays; respect reduced motion.
