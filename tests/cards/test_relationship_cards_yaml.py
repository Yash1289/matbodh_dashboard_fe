from __future__ import annotations

from pathlib import Path

from matbodh_dashboard.cards.config import load_cards
from matbodh_dashboard.registry import load_rules
from tests.cards.test_relationship_compile import _compile

ROOT = Path(__file__).resolve().parents[2]
CARDS = load_cards(ROOT / "tests" / "fixtures" / "cards.yaml")


def test_both_starter_cards_load_with_their_views():
    past, mla = CARDS["relationship.up_past_to_current"], CARDS["relationship.up_mla_to_current"]
    assert (past.relationship.origin, mla.relationship.origin) == ("vs_past", "mla_choice_party")
    assert past.relationship.destination == mla.relationship.destination == "vs_voting_intention"
    assert past.relationship.focal_party == mla.relationship.focal_party == "NDA"
    assert (past.view.table, mla.view.table) == ("summary", "matrix")
    assert past.cuts == mla.cuts == [[], ["gender"]]


def test_both_starter_cards_compile_and_differ_only_in_the_origin():
    a = _compile(CARDS["relationship.up_past_to_current"])
    b = _compile(CARDS["relationship.up_mla_to_current"])
    assert a.unavailable == () and b.unavailable == ()
    ja, jb = a.jobs[0].config, b.jobs[0].config
    assert ja["relationship"]["origin"] != jb["relationship"]["origin"]
    ja["relationship"]["origin"] = jb["relationship"]["origin"] = "x"
    ja["request"]["scenarios"][0] = jb["request"]["scenarios"][0] = "x"
    assert ja == jb


def test_gender_other_is_hidden_by_the_global_presentation_rules():
    rules = load_rules(ROOT / "config" / "presentation")
    assert rules.order("gender", ["Female", "Male", "Other"], states=["Uttar Pradesh"]) == ["Female", "Male"]
    assert rules.order("age_group", ["18-25", "26-35"], states=["Uttar Pradesh"]) == ["18-25", "26-35"]
