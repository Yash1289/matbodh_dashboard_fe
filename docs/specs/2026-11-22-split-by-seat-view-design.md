# Split by: a seat view, nested cuts, no crossing of seat fields

Status: confirmed by the owner, 2026-11-22 (three answers to the shape questions). Operate surface (Configure dialog) plus the card's table.

## Job and audience
An analyst builds a card's tables in the Configure dialog's "How to split it". Today a seat field crossed with a demographic becomes a card selector, explained by a note; crossing is a per-row dropdown that can repeat a cut; building a tree (age group, then gender) means adding the parent table by hand.

## Decisions (owner)
1. **View by seat attribute** is a dedicated dropdown at the top of Split by, listing only seat-level fields (party_zone, ac_num, pc_num ...). Set once, it applies to every table of the card: each table is read for one value of it at a time, with the chooser on the card. The analyst sets the attribute only; the viewer picks the value.
2. **While View by is set, seat fields leave the cut list.** A table is never both filtered and split by seat. With View by empty, a seat field is a table on its own and cannot be crossed with anything.
3. **Crossing builds one nested cut.** "age group › gender" adds the age group table and the age group × gender table; Cascaded then shows them as one tree. Removing the item removes both.
4. Fixed in this slice already: a cut can no longer be added twice (the builder drew duplicates and the card refused them); Pop % is left out when no row has a share.

## Model (no backend change)
The card keeps `cuts: string[][]`. The dialog reads and writes it through a small pure model:
- View by F with demographic items: every cut is prefixed with F; Overall is `[F]`; an item `a › b › c` is `[F,a]`, `[F,a,b]`, `[F,a,b,c]`.
- View by empty: Overall is `[]`; an item `a › b` is `[a]`, `[a,b]`; a seat field is `[F]` alone.
- Reading a saved card: View by F when every non-empty cut starts with the same seat field and at least one is crossed; an item is nested when all its parent cuts are present, otherwise it is shown as a flat cross and kept exactly as saved.

## Card side
With View by set, every chain cut is narrowed to the chosen seat value and the seat part is removed from its row keys, so the existing tree logic reads a plain chain. Population shares follow their rows.

## Anti-goals
A hard value filter in the dialog; seat fields crossed with anything; changing the engine request shape; adding a note to explain what the control already shows.

## States
No seat fields available (family or level): the View by control is not drawn. Legacy crossed cuts: shown as flat items with their fields named, removable, never crossed further.
