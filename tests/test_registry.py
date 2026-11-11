from pathlib import Path

import pytest

from matbodh_dashboard.registry import load_rules

GLOBAL = """\
rules:
  - field: party
    order: [NDA, SP+, BSP, Other, Undecided, NOTA]
    pin_last: [Other, Undecided, NOTA]
    unknown: append_alpha
  - field: zone
    order: [West, East]
"""

UP = """\
rules:
  - field: zone
    scope: {state: Uttar Pradesh}
    order: [East, West, Centre]
    labels: {East: Purvanchal}
  - field: caste
    scope: {state: Uttar Pradesh}
    order: [Brahmin, Yadav]
    hidden: [Tiny]
"""

BIHAR = """\
rules:
  - field: zone
    scope: {state: Bihar}
    order: [North, West, South]
"""


def _write(tmp_path: Path, **files: str) -> Path:
    tmp_path.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (tmp_path / f"{name}.yaml").write_text(text, encoding="utf-8")
    return tmp_path


def test_state_rule_overrides_global(tmp_path):
    rules = load_rules(_write(tmp_path, a_global=GLOBAL, up=UP))
    values = ["West", "East", "Centre"]
    assert rules.order("zone", values) == ["West", "East", "Centre"]
    assert rules.order("zone", values, states=["Uttar Pradesh"]) == [
        "East", "West", "Centre",
    ]


def test_unknown_values_appended_not_dropped(tmp_path):
    rules = load_rules(_write(tmp_path, a_global=GLOBAL))
    out = rules.order("party", ["NOTA", "JDL", "BSP", "NDA", "Other"])
    assert out == ["NDA", "BSP", "JDL", "Other", "NOTA"]


def test_unknown_append_end_keeps_input_order(tmp_path):
    text = "rules:\n  - field: f\n    order: [A]\n    unknown: append_end\n"
    rules = load_rules(_write(tmp_path, g=text))
    assert rules.order("f", ["Z", "A", "M"]) == ["A", "Z", "M"]


def test_wildcard_pin_last(tmp_path):
    pin = "rules:\n  - field: p\n    order: [A]\n    pin_last: ['Other *']\n"
    rules = load_rules(_write(tmp_path, b=pin))
    out = rules.order("p", ["Other OBC", "B", "A"])
    assert out == ["A", "B", "Other OBC"]


def test_pin_first(tmp_path):
    text = "rules:\n  - field: f\n    order: [A, B]\n    pin_first: [B]\n"
    rules = load_rules(_write(tmp_path, g=text))
    assert rules.order("f", ["A", "B", "C"]) == ["B", "A", "C"]


def test_multi_state_merge(tmp_path):
    rules = load_rules(_write(tmp_path, a_global=GLOBAL, up=UP, bihar=BIHAR))
    out = rules.order(
        "zone", ["South", "Centre", "West", "East", "North"],
        states=["Uttar Pradesh", "Bihar"],
    )
    # global order first (West, East), then state-only values in state order
    assert out == ["West", "East", "Centre", "North", "South"]


def test_hidden_values_excluded_and_counted(tmp_path):
    rules = load_rules(_write(tmp_path, up=UP))
    values = ["Yadav", "Tiny", "Brahmin"]
    assert rules.order("caste", values, states=["Uttar Pradesh"]) == [
        "Brahmin", "Yadav",
    ]
    assert rules.hidden_count("caste", values, states=["Uttar Pradesh"]) == 1
    assert rules.hidden_count("caste", values) == 0


def test_label_and_colour(tmp_path):
    text = UP + "  - field: party\n    colours: {NDA: '#888888'}\n"
    rules = load_rules(_write(tmp_path, up=text))
    assert rules.label("zone", "East", "Uttar Pradesh") == "Purvanchal"
    assert rules.label("zone", "East") == "East"
    assert rules.label("zone", "West", "Uttar Pradesh") == "West"
    assert rules.colour("party", "NDA") == "#888888"
    assert rules.colour("party", "BSP") is None


def test_within_selects_rule(tmp_path):
    text = (
        "rules:\n"
        "  - field: f\n    order: [A, B]\n"
        "  - field: f\n    within: g\n    order: [B, A]\n"
    )
    rules = load_rules(_write(tmp_path, g=text))
    assert rules.order("f", ["A", "B"]) == ["A", "B"]
    assert rules.order("f", ["A", "B"], within="g") == ["B", "A"]


def test_invalid_rules_rejected(tmp_path):
    bad = "rules:\n  - field: f\n    unknown: nope\n"
    with pytest.raises(ValueError, match="'unknown' must be one of"):
        load_rules(_write(tmp_path / "a", g=bad))
    extra = "rules:\n  - field: f\n    bogus: 1\n"
    with pytest.raises(ValueError, match="unknown rule keys"):
        load_rules(_write(tmp_path / "b", h=extra))


def test_unknown_top_level_key_rejected(tmp_path):
    with pytest.raises(ValueError, match="unknown top-level keys"):
        load_rules(_write(tmp_path / "a", g="rulez: []\nrules: []\n"))


def test_duplicate_rule_rejected(tmp_path):
    dup = "rules:\n  - field: f\n    order: [A]\n  - field: f\n    order: [B]\n"
    with pytest.raises(ValueError, match="duplicate rule"):
        load_rules(_write(tmp_path / "a", g=dup))
    one = "rules:\n  - field: f\n    order: [A]\n"
    with pytest.raises(ValueError, match="duplicate rule"):
        load_rules(_write(tmp_path / "b", g1=one, g2=one))


def test_bom_file_loads(tmp_path):
    (tmp_path / "g.yaml").write_bytes(
        b"\xef\xbb\xbf" + b"rules:\n  - field: f\n    order: [B, A]\n"
    )
    assert load_rules(tmp_path).order("f", ["A", "B"]) == ["B", "A"]


def test_append_alpha_is_case_insensitive(tmp_path):
    text = "rules:\n  - field: f\n    order: [A]\n"
    rules = load_rules(_write(tmp_path, g=text))
    assert rules.order("f", ["b", "C", "A", "a2"]) == ["A", "a2", "b", "C"]


def test_append_alpha_orders_numbers_by_value(tmp_path):
    text = "rules:\n  - field: f\n    order: [A]\n"
    rules = load_rules(_write(tmp_path, g=text))
    assert rules.order("f", ["10", "2", "100", "1"]) == ["1", "2", "10", "100"]
    assert rules.order("f", ["AC 10", "ac 9", "AC 2"]) == ["AC 2", "ac 9", "AC 10"]


def test_hidden_count_respects_within(tmp_path):
    text = (
        "rules:\n"
        "  - field: f\n    hidden: [X]\n"
        "  - field: f\n    within: g\n    hidden: [X, Y]\n"
    )
    rules = load_rules(_write(tmp_path, g=text))
    values = ["X", "Y", "Z"]
    assert rules.hidden_count("f", values) == 1
    assert rules.hidden_count("f", values, within="g") == 2
    assert rules.order("f", values, within="g") == ["Z"]


def test_version_changes_when_rule_changes(tmp_path):
    _write(tmp_path, g=GLOBAL)
    v1 = load_rules(tmp_path).version
    assert load_rules(tmp_path).version == v1
    _write(tmp_path, g=GLOBAL.replace("NDA", "ALLIANCE"))
    assert load_rules(tmp_path).version != v1


def test_seed_config_loads():
    root = Path(__file__).resolve().parents[1] / "config" / "presentation"
    rules = load_rules(root)
    assert rules.order("party", ["NOTA", "BSP", "NDA"]) == ["NDA", "BSP", "NOTA"]
    zones = rules.order(
        "party_zone", ["Rohilkhand", "Bundelkhand"], states=["Uttar Pradesh"]
    )
    assert zones == ["Bundelkhand", "Rohilkhand"]
