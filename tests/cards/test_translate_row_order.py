"""Rows are ordered by the registry at every level of a cut, parent first, each level inside its parent."""
from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.families import FAMILIES
from matbodh_dashboard.cards.translate import translate_grid
from matbodh_dashboard.registry import load_rules
from tests.cards.translate_helpers import VS, context_for, dim, mini_result, mini_row


def _translate(tmp_path, yaml_text, rows, cuts):
    (tmp_path / "global.yaml").write_text(yaml_text, encoding="utf-8")
    config = CardConfig.model_validate({"id": "c1", "family": "distribution", "section": "cards",
                                        "title": "T", "scenarios": [VS], "cuts": cuts})
    result = mini_result(rows=rows)
    return translate_grid(config, FAMILIES["distribution"], result,
                          context_for(result, rules=load_rules(tmp_path)))


def _keys(payload, cut_id):
    return [r.key for r in next(c for c in payload.cuts if c.id == cut_id).rows]


def _two(gs, first, second, **extra):
    return mini_row(gs=gs, dims={"age_group": dim(first), "gender": dim(second)}, **extra)


AGE_GENDER = """rules:
  - field: age_group
    order: ["18-25", "26-35", "60+"]
  - field: gender
    order: [Male, Female]
    hidden: [Other]
"""


def test_two_level_cut_orders_children_inside_each_parent(tmp_path):
    parents = [mini_row(gs="g0", dims={"age_group": dim(a)}) for a in ("60+", "26-35", "18-25")]
    children = [_two("g1", a, g) for a, g in
                (("26-35", "Female"), ("18-25", "Female"), ("18-25", "Male"), ("26-35", "Male"))]
    payload = _translate(tmp_path, AGE_GENDER, parents + children,
                         [["age_group"], ["age_group", "gender"]])
    assert _keys(payload, "g0") == ["age_group=18-25", "age_group=26-35", "age_group=60+"]
    assert _keys(payload, "g1") == [
        "age_group=18-25|gender=Male", "age_group=18-25|gender=Female",
        "age_group=26-35|gender=Male", "age_group=26-35|gender=Female"]


def test_within_rule_orders_castes_per_category(tmp_path):
    yaml_text = """rules:
  - field: category
    order: [GEN, NY-OBC]
  - field: caste
    pin_last: ["Other *"]
  - field: caste
    within: GEN
    order: [Brahmin, Thakur]
    pin_last: [Other GEN]
"""
    pairs = [("GEN", "Thakur"), ("GEN", "Other GEN"), ("GEN", "Brahmin"), ("GEN", "Zeta"),
             ("NY-OBC", "Other NY-OBC"), ("NY-OBC", "Kurmi")]
    rows = [mini_row(gs="g0", dims={"category": dim(c), "caste": dim(s)}) for c, s in pairs]
    payload = _translate(tmp_path, yaml_text, rows, [["category", "caste"]])
    assert _keys(payload, "g0") == [
        "category=GEN|caste=Brahmin", "category=GEN|caste=Thakur", "category=GEN|caste=Zeta",
        "category=GEN|caste=Other GEN", "category=NY-OBC|caste=Kurmi", "category=NY-OBC|caste=Other NY-OBC"]


def test_null_child_sorts_last_and_stays(tmp_path):
    rows = [_two("g0", "18-25", None), _two("g0", "18-25", "Female"), _two("g0", "18-25", "Male")]
    payload = _translate(tmp_path, AGE_GENDER, rows, [["age_group", "gender"]])
    assert _keys(payload, "g0") == [
        "age_group=18-25|gender=Male", "age_group=18-25|gender=Female", "age_group=18-25|gender=~null"]


def test_hidden_gender_other_drops_child_rows(tmp_path):
    rows = [_two("g0", "18-25", "Male"), _two("g0", "18-25", "Other"), _two("g0", "26-35", "Other")]
    payload = _translate(tmp_path, AGE_GENDER, rows, [["age_group", "gender"]])
    cut = payload.cuts[0]
    assert [r.key for r in cut.rows] == ["age_group=18-25|gender=Male"]
    assert {c.row for c in cut.cells} == {"age_group=18-25|gender=Male"}
    assert payload.hidden_count == 2


def test_single_dimension_cut_unchanged(tmp_path):
    rows = [mini_row(dims={"age_group": dim(a)}) for a in ("60+", "18-25", "Unlisted", "26-35")]
    payload = _translate(tmp_path, AGE_GENDER, rows, [["age_group"]])
    assert _keys(payload, "g0") == ["age_group=18-25", "age_group=26-35", "age_group=60+", "age_group=Unlisted"]
