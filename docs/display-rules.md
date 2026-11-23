# Display rules

How a table orders, hides, renames and colours its values. Rules never change a number. They live in plain YAML under `config/presentation/`, and editing a rule means editing that file only: no code names a field such as `gender` or `age_group`.

- `global.yaml` applies to every state.
- `<state-slug>.yaml` (for example `uttar-pradesh.yaml`) applies to one state and wins over `global.yaml`.
- Restart the API after an edit. A mistake stops the load with the file, entry number and key, for example `bad.yaml[0]: unknown rule keys ['colors']`.

One entry orders one field:

```yaml
rules:
  - field: gender                  # the field's name in a cut: gender, age_group, category, caste, party, party_zone ...
    scope: {state: Uttar Pradesh}  # only in a state's file; leave out in global.yaml
    order: [Male, Female]          # shown in this order; values not listed follow, A to Z
```

## What an entry can say

```yaml
  - field: party
    order: [NDA, SP+, BSP]                 # first, in this order
    pin_first: [NDA]                       # always first
    pin_last: [Other, Undecided, NOTA]     # always last, in this order
    unknown: append_alpha                  # values not listed: A to Z (default) or append_end (engine order)
    hidden: [NOTA]                         # never shown (display only; the count is reported)
    labels: {NDA: "NDA (BJP+)"}            # shown name for a value
    colours: {NDA: "#FF9933"}              # one colour per value
```

`pin_first`, `pin_last` and `hidden` accept a trailing `*` to match by prefix: `pin_last: ["Other *"]` puts `Other GEN`, `Other NY-OBC` and so on last.

## Order inside a parent (cascaded tables)

In a cascaded table (cuts such as age group, then age group by gender) each level is ordered on its own, inside its parent row. `within` makes an entry apply under one parent value:

```yaml
  - field: caste
    pin_last: ["Other *"]           # every category: its grouped-up castes last

  - field: caste
    within: GEN                     # only castes under category GEN
    order: [Brahmin, Thakur]
    pin_last: [Other GEN]           # a `within` entry replaces the general one, so repeat what it needs
```

Values with no value in the data (shown "(no value)") sort last in their level.

## The Uttar Pradesh entries now in use

| File | Field | Rule |
| --- | --- | --- |
| `global.yaml` | `party` | order NDA, SP+, BSP, Other, Undecided, NOTA; the last three pinned last |
| `global.yaml` | `gender` | `Other` hidden in every table |
| `global.yaml` | `caste` | `Other *` pinned last |
| `uttar-pradesh.yaml` | `party` | order NDA, SP+, BSP (Other stays last from `global.yaml`; any other party, such as INDI from a past election, follows the listed ones). Applies to party columns and to the Seat benchmark's rows, Summary columns and Parties shown / Focal party lists |
| `uttar-pradesh.yaml` | `gender` | Male, Female |
| `uttar-pradesh.yaml` | `age_group` | 18-23, 24-35, 36-50, 51-60, 60+ (the labels the UP surveys carry) |
| `uttar-pradesh.yaml` | `category` | GEN, Yadav, NY-OBC, Jatav, NJ-SC/ST, Muslim |
| `uttar-pradesh.yaml` | `party_zone` | alphabetical seed list |

When a survey carries a label an `order` list does not name, the label is still shown, after the listed ones.
