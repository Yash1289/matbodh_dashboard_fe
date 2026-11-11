import pytest

from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.families import family_meta, get_family

PARTY, OPINION = "vs_voting_intention", "pm_satisfaction"


def make(family="seat_ranking", rank=None, **overrides) -> CardConfig:
    data = {"id": "r1", "family": family, "section": "rankings", "title": "T",
            "scenarios": [OPINION],
            "rank": {"metric": "net_score", "level": "ac", **(rank or {})}}
    data.update(overrides)
    return CardConfig.model_validate(data)


def demographic(rank=None, **overrides) -> CardConfig:
    rank = {"metric": "support_share", "party_id": "NDA", "level": "caste",
            "partition_by": ["ac_num"], "top_k": 3, **(rank or {})}
    return make("demographic_ranking", rank, scenarios=[PARTY], **overrides)


def test_seat_ranking_allows_no_top_k_and_any_top_k():
    assert make().rank.top_k is None
    assert make(rank={"top_k": 50}).rank.top_k == 50


@pytest.mark.parametrize("top_k", [None, 0, 6])
def test_demographic_requires_top_k_one_to_five(top_k):
    with pytest.raises(ValueError, match="top_k"):
        demographic({"top_k": top_k})


@pytest.mark.parametrize("top_k", [1, 5])
def test_demographic_accepts_the_bounds(top_k):
    assert demographic({"top_k": top_k}).rank.top_k == top_k


def test_demographic_level_not_in_partition():
    with pytest.raises(ValueError, match="distinct"):
        demographic({"partition_by": ["caste"]})


def test_seat_level_must_be_ac_or_pc():
    with pytest.raises(ValueError, match="ac or pc"):
        make(rank={"level": "caste"})


def test_party_metric_needs_party_id_and_opinion_forbids_it():
    with pytest.raises(ValueError, match="party_id"):
        make(scenarios=[PARTY], rank={"metric": "support_share"})
    with pytest.raises(ValueError, match="party_id"):
        make(rank={"party_id": "NDA"})
    with pytest.raises(ValueError, match="does not match"):
        make(scenarios=[PARTY], rank={"metric": "net_score"})


def test_ranking_card_needs_rank_block_and_grid_card_forbids_it():
    with pytest.raises(ValueError, match="rank"):
        CardConfig.model_validate({"id": "x", "family": "seat_ranking", "section": "s",
                                   "title": "T", "scenarios": [OPINION]})
    with pytest.raises(ValueError, match="rank"):
        CardConfig.model_validate({"id": "x", "family": "distribution", "section": "s",
                                   "title": "T", "scenarios": [PARTY],
                                   "rank": {"metric": "net_score", "level": "ac"}})


def _compare(**extra):
    return {"mode": "compare", "target": {"scenario": OPINION},
            "reference": {"round": "compare", "scenario": OPINION}, **extra}


def test_compare_needs_distinct_endpoints_and_no_delta_measures():
    assert make(scenarios=[], comparison=_compare()).comparison.mode == "compare"
    same = {"round": "compare", "scenario": OPINION}
    with pytest.raises(ValueError, match="same endpoint"):
        make(scenarios=[], comparison={"mode": "compare", "target": same, "reference": same})
    with pytest.raises(ValueError, match="delta_measures"):
        make(scenarios=[], comparison=_compare(delta_measures=["net_score"]))


def test_trend_needs_one_scenario():
    make(comparison={"mode": "trend"})
    with pytest.raises(ValueError, match="exactly one scenario"):
        make(scenarios=[OPINION, "cm_satisfaction"], comparison={"mode": "trend"})


def test_seat_ranking_rejects_card_level_filters_and_caste_clubbing():
    with pytest.raises(ValueError, match="filters"):
        make(filters=[{"field": "gender", "values": ["Female"]}])
    with pytest.raises(ValueError, match="caste_clubbing"):
        make(caste_clubbing=True)


def test_demographic_rejects_caste_clubbing_but_allows_filters():
    with pytest.raises(ValueError, match="caste_clubbing"):
        demographic(caste_clubbing=True)
    assert demographic(filters=[{"field": "gender", "values": ["Female"]}]).filters


def test_ranking_families_are_registered():
    spec = get_family("seat_ranking")
    assert spec.lenses == ()
    assert family_meta(spec).family == "seat_ranking"
    assert get_family("demographic_ranking").lenses == ()
