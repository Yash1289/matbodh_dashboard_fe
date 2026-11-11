import pytest

from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.families import family_meta, get_family

PARTY, OPINION = "vs_voting_intention", "pm_satisfaction"


def make(**overrides) -> CardConfig:
    data = {"id": "b1", "family": "seat_benchmark", "section": "benchmarks", "title": "T",
            "scenarios": [PARTY],
            "benchmark": {"focal_party": "NDA", "grouping_sets": [[], ["party_zone"]]},
            "view": {"table": "comparison"}}
    data.update(overrides)
    return CardConfig.model_validate(data)


def test_valid_benchmark_card_loads():
    card = make()
    assert card.benchmark.focal_party == "NDA"
    assert card.benchmark.grouping_sets == [[], ["party_zone"]]
    assert card.view.table == "comparison"
    assert family_meta(get_family("seat_benchmark")).lenses == []


def test_benchmark_needs_benchmark_block():
    with pytest.raises(ValueError, match="benchmark block"):
        make(benchmark=None)


@pytest.mark.parametrize("extra", [
    {"rank": {"metric": "support_share", "party_id": "NDA", "level": "ac"}},
    {"caste_clubbing": True},
    {"comparison": {"mode": "standalone", "delta_measures": ["support_share"]}},
    {"filters": [{"field": "gender", "values": ["Male"]}]},
])
def test_benchmark_rejects_ranking_and_analysis_options(extra):
    with pytest.raises(ValueError):
        make(**extra)


def test_benchmark_needs_exactly_one_party_scenario():
    with pytest.raises(ValueError, match="party scenario"):
        make(scenarios=[OPINION])
    with pytest.raises(ValueError, match="exactly one"):
        make(scenarios=[PARTY, "vs_past"])


@pytest.mark.parametrize("mode", ["compare", "trend"])
def test_benchmark_comparison_must_be_standalone(mode):
    comparison = {"mode": mode}
    if mode == "compare":
        comparison.update(target={"round": "anchor", "scenario": PARTY},
                          reference={"round": "compare", "scenario": PARTY})
    with pytest.raises(ValueError, match="standalone"):
        make(comparison=comparison)


def test_duplicate_grouping_sets_rejected():
    with pytest.raises(ValueError, match="duplicate"):
        make(benchmark={"focal_party": "NDA", "grouping_sets": [["party_zone"], ["party_zone"]]})
    with pytest.raises(ValueError, match="duplicate"):
        make(benchmark={"focal_party": "NDA", "grouping_sets": [["party_zone", "party_zone"]]})


def test_view_and_benchmark_only_on_the_benchmark_family():
    with pytest.raises(ValueError, match="benchmark families only"):
        CardConfig.model_validate({"id": "d", "family": "distribution", "section": "s", "title": "T",
                                   "scenarios": [PARTY], "view": {"table": "flips"}})
