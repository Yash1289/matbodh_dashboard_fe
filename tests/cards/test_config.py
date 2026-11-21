from pathlib import Path

import pytest

from matbodh_dashboard.cards.config import (
    CardConfig,
    comparison_kind,
    load_cards,
    scenario_kind,
)

ROOT = Path(__file__).resolve().parents[2]
PARTY, PARTY2, OPINION = "vs_voting_intention", "ls_past", "pm_satisfaction"


def make(**overrides) -> CardConfig:
    data = {"id": "c1", "family": "distribution", "section": "cards", "title": "T",
            "scenarios": [PARTY]}
    data.update(overrides)
    return CardConfig.model_validate(data)


def test_scenario_kind_comes_from_the_engine_catalogue():
    assert scenario_kind(PARTY) == "party"
    assert scenario_kind(OPINION) == "opinion"
    with pytest.raises(ValueError, match="unknown scenario"):
        scenario_kind("not_a_scenario")


def test_distribution_rejects_opinion_scenario():
    with pytest.raises(ValueError, match="scenario kind"):
        make(scenarios=[OPINION])


def test_opinion_rejects_party_scenario():
    with pytest.raises(ValueError, match="scenario kind"):
        make(family="opinion", scenarios=[PARTY])


def test_standalone_needs_a_scenario():
    with pytest.raises(ValueError, match="at least one scenario"):
        make(scenarios=[])


def test_gender_differential_rejects_compare_mode():
    with pytest.raises(ValueError, match="gender differential"):
        make(family="gender_differential", comparison={
            "mode": "compare", "target": {"scenario": PARTY}, "reference": {"scenario": PARTY2}})


def test_gender_differential_rejects_gender_in_cuts():
    with pytest.raises(ValueError, match="gender"):
        make(family="gender_differential", cuts=[[], ["gender"]])


def test_gender_differential_allows_trend_and_standalone():
    make(family="gender_differential")
    make(family="gender_differential", comparison={"mode": "trend"})


def test_duplicate_cuts_rejected():
    with pytest.raises(ValueError, match="duplicate cut"):
        make(cuts=[["category", "caste"], ["caste", "category"]])


def test_empty_cuts_rejected_but_overall_grain_allowed():
    with pytest.raises(ValueError, match="at least one cut"):
        make(cuts=[])
    make(cuts=[[]])


def test_compare_rejects_identical_endpoints():
    same = {"round": "compare", "scenario": PARTY}
    with pytest.raises(ValueError, match="same endpoint"):
        make(scenarios=[], comparison={"mode": "compare", "target": same, "reference": same})


def test_compare_rejects_duplicate_delta_measures():
    with pytest.raises(ValueError, match="duplicate delta_measures"):
        make(family="opinion", scenarios=[], comparison={
            "mode": "compare", "target": {"scenario": OPINION},
            "reference": {"round": "compare", "scenario": OPINION},
            "delta_measures": ["net_score", "net_score"]})


def test_filter_needs_values():
    with pytest.raises(ValueError):
        make(filters=[{"field": "party_zone", "values": []}])


def test_filter_one_entry_per_field():
    with pytest.raises(ValueError, match="one filter per field"):
        make(filters=[{"field": "party_zone", "values": ["A"]},
                      {"field": "party_zone", "operator": "not_in", "values": ["B"]}])


def test_filter_operator_must_be_in_or_not_in():
    with pytest.raises(ValueError):
        make(filters=[{"field": "party_zone", "operator": "eq", "values": ["A"]}])


def test_caste_clubbing_needs_caste_in_a_cut():
    with pytest.raises(ValueError, match="caste"):
        make(caste_clubbing=True, cuts=[[], ["category"]])
    make(caste_clubbing=True, cuts=[[], ["category", "caste"]])


def test_standalone_forbids_endpoints():
    with pytest.raises(ValueError, match="standalone"):
        make(comparison={"mode": "standalone", "target": {"scenario": PARTY}})


def test_compare_needs_both_endpoints():
    with pytest.raises(ValueError, match="target and reference"):
        make(scenarios=[], comparison={"mode": "compare", "target": {"scenario": PARTY}})


def test_trend_needs_exactly_one_scenario():
    with pytest.raises(ValueError, match="exactly one scenario"):
        make(scenarios=[PARTY, PARTY2], comparison={"mode": "trend"})
    make(comparison={"mode": "trend"})


def test_compare_derives_scenarios_from_endpoints():
    config = make(scenarios=[], comparison={
        "mode": "compare", "target": {"scenario": PARTY}, "reference": {"scenario": PARTY2}})
    assert config.scenarios == [PARTY, PARTY2]


def test_comparison_kind_matrix():
    assert comparison_kind("party", "party") == "difference"
    assert comparison_kind("opinion", "opinion") == "difference"
    assert comparison_kind("party", "opinion") == "shakti"
    with pytest.raises(ValueError, match="opinion target"):
        comparison_kind("opinion", "party")


def test_party_compare_defaults_and_validates_delta_measures():
    base = {"mode": "compare", "target": {"scenario": PARTY},
            "reference": {"round": "compare", "scenario": PARTY}}
    assert make(scenarios=[], comparison=base).comparison.delta_measures == ["support_share"]
    with pytest.raises(ValueError, match="delta measure"):
        make(scenarios=[], comparison={**base, "delta_measures": ["net_score"]})


def test_opinion_compare_defaults_and_validates_delta_measures():
    base = {"mode": "compare", "target": {"scenario": OPINION},
            "reference": {"round": "compare", "scenario": OPINION}}
    config = make(family="opinion", scenarios=[], comparison=base)
    assert config.comparison.delta_measures == ["net_score"]
    both = make(family="opinion", scenarios=[], comparison={
        **base, "delta_measures": ["net_score", "positive_share"]})
    assert both.comparison.delta_measures == ["net_score", "positive_share"]
    with pytest.raises(ValueError, match="delta measure"):
        make(family="opinion", scenarios=[], comparison={**base, "delta_measures": ["support_share"]})


def test_shakti_ignores_delta_measures():
    config = make(scenarios=[], comparison={
        "mode": "compare", "target": {"scenario": PARTY}, "reference": {"scenario": OPINION},
        "delta_measures": ["net_score"]})
    assert config.comparison.delta_measures == []


def test_load_cards_rejects_duplicate_ids_and_unknown_keys(tmp_path):
    card = "  - {id: a, family: distribution, section: cards, title: A, scenarios: [vs_voting_intention]}\n"
    path = tmp_path / "cards.yaml"
    path.write_text("cards:\n" + card + card, encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate card id"):
        load_cards(path)
    path.write_text("cards:\n" + card.replace("title: A", "title: A, bogus: 1"), encoding="utf-8")
    with pytest.raises(ValueError):
        load_cards(path)


def test_seed_cards_load():
    cards = load_cards(ROOT / "tests/fixtures/cards.yaml")
    assert {"distribution.support_by_caste", "opinion.leaders", "gender.gap_by_zone",
            "ranking.ac_pm_net", "ranking.ac_bjp_support_by_zone", "ranking.pc_pm_net",
            "ranking.castes_by_ac_support"} <= set(cards)


def test_copied_config_loads(tmp_path):
    """Configure's "Copy config" puts one YAML list item (JSON, with its id) on the clipboard; the owner
    pastes it under `cards:` in cards.yaml, and load_cards accepts it."""
    pasted = ('- {"id": "mine.1", "family": "distribution", "title": "T: with, punctuation", '
              '"scenarios": ["vs_voting_intention"], "cuts": [[], ["caste"]], "caste_clubbing": true, '
              '"comparison": {"mode": "standalone"}, "pipe_rounds": null, "display_parties": ["NDA"]}')
    path = tmp_path / "cards.yaml"
    path.write_text("cards:\n" + pasted + "\n", encoding="utf-8")
    card = load_cards(path)["mine.1"]
    assert card.title == "T: with, punctuation" and card.caste_clubbing and card.display_parties == ["NDA"]


def _surveys_card(**kw):
    data = {"id": "c", "family": "distribution", "title": "T", "scenarios": ["vs_voting_intention"],
            "surveys": ["A", "B"]}
    data.update(kw)
    return CardConfig.model_validate(data)


def test_surveys_accepted_for_distribution_and_opinion():
    assert _surveys_card().surveys == ["A", "B"]
    assert _surveys_card(family="opinion", scenarios=["pm_satisfaction"]).surveys == ["A", "B"]


@pytest.mark.parametrize("bad", [
    {"family": "seat_ranking", "rank": {"level": "ac", "metric": "support_share", "party_id": "BJP"}},
    {"surveys": ["A", "A"]}, {"anchor_round": "A"},
    {"comparison": {"mode": "trend"}, "pipe_rounds": 2},
    {"comparison": {"mode": "trend"}, "surveys": ["A"]},
    {"family": "seat_ranking", "comparison": {"mode": "trend"},
     "rank": {"level": "ac", "metric": "support_share", "party_id": "BJP"}},
])
def test_surveys_rejected_elsewhere(bad):
    with pytest.raises(Exception):
        _surveys_card(**bad)


def test_several_questions_across_surveys_reject_cuts():
    with pytest.raises(Exception, match="cuts"):
        _surveys_card(scenarios=["vs_voting_intention", "ls_past"], cuts=[["age_group"]])
    assert _surveys_card(scenarios=["vs_voting_intention", "ls_past"]).cuts == [[]]


def test_a_trend_may_follow_a_chosen_set_of_surveys():
    card = _surveys_card(comparison={"mode": "trend"}, scenarios=["vs_voting_intention"], surveys=["A", "C"])
    assert card.surveys == ["A", "C"]
    assert _surveys_card(family="opinion", scenarios=["pm_satisfaction"], comparison={"mode": "trend"}).surveys == ["A", "B"]
