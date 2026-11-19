"""CardConfig additions for the Configure surface (spec 6a, sections 4, 5, 8.2)."""
import pytest

from matbodh_dashboard.cards.config import SEGMENT_FIELDS, CardConfig

PARTY, RECALLED, OPINION = "vs_voting_intention", "vs_past", "pm_satisfaction"


def make(**overrides) -> CardConfig:
    data = {"id": "c1", "family": "distribution", "title": "T", "scenarios": [PARTY]}
    data.update(overrides)
    return CardConfig.model_validate(data)


def relationship(**joint) -> CardConfig:
    return CardConfig.model_validate({
        "id": "r1", "family": "relationship", "title": "R",
        "relationship": {"origin": RECALLED, "destination": PARTY, **({"joint_weight": joint} if joint else {})},
    })


def benchmark(**fields) -> CardConfig:
    return CardConfig.model_validate({
        "id": "b1", "family": "seat_benchmark", "title": "B", "scenarios": [PARTY],
        "benchmark": {"focal_party": "NDA", **fields},
    })


def test_pipe_rounds_must_be_positive():
    assert make(comparison={"mode": "trend"}, pipe_rounds=3).pipe_rounds == 3
    assert make().pipe_rounds is None
    with pytest.raises(ValueError):
        make(pipe_rounds=0)


def test_section_optional():
    assert make().section == "cards"
    assert make().requires.min_level == "state"
    pc_ranking = CardConfig.model_validate({
        "id": "p1", "family": "seat_ranking", "title": "P", "scenarios": [OPINION],
        "rank": {"metric": "net_score", "level": "pc"},
    })
    assert pc_ranking.requires.min_level == "state"  # an "ac" default would block PC-level surveys


def test_display_parties_party_rows_only_on_opinion():
    with pytest.raises(ValueError, match=r"@display_parties:"):
        make(family="opinion", scenarios=[OPINION], display_parties=["NDA"])


def test_display_parties_party_rows_only_on_seat_ranking():
    with pytest.raises(ValueError, match=r"@display_parties:"):
        CardConfig.model_validate({
            "id": "p1", "family": "seat_ranking", "title": "P", "scenarios": [OPINION],
            "rank": {"metric": "net_score", "level": "ac"}, "display_parties": ["NDA"],
        })


def test_display_parties_accepted_on_party_row_families():
    assert make(display_parties=["NDA", "Other"]).display_parties == ["NDA", "Other"]
    assert make(family="gender_differential", display_parties=["NDA"]).display_parties == ["NDA"]


def test_benchmark_contenders_rules():
    assert benchmark(contenders=["NDA", "SP+"]).benchmark.contenders == ["NDA", "SP+"]
    assert benchmark().benchmark.contenders is None
    with pytest.raises(ValueError, match=r"@benchmark.contenders:"):
        benchmark(contenders=["SP+", "BSP"])
    with pytest.raises(ValueError, match=r"@benchmark.contenders:"):
        benchmark(contenders=["NDA", "NDA"])


def test_benchmark_reference_in_config():
    card = benchmark(reference={"kind": "election", "year": 2022, "election_type": "VS"})
    assert card.benchmark.reference.year == 2022


def test_joint_weight_scenario_rules():
    assert relationship().relationship.joint_weight.source == "base"
    assert relationship(source="scenario", scenario=PARTY).relationship.joint_weight.scenario == PARTY
    with pytest.raises(ValueError, match=r"@relationship.joint_weight.scenario:"):
        relationship(source="scenario")
    with pytest.raises(ValueError, match=r"@relationship.joint_weight.scenario:"):
        relationship(source="base", scenario=PARTY)
    with pytest.raises(ValueError, match=r"@relationship.joint_weight.scenario:"):
        relationship(source="scenario", scenario=RECALLED)  # no embedded weights
    with pytest.raises(ValueError, match=r"@relationship.joint_weight.scenario:"):
        relationship(source="scenario", scenario=OPINION)


def test_errors_carry_paths():
    with pytest.raises(ValueError, match=r"@scenarios:"):
        make(comparison={"mode": "trend"}, scenarios=[PARTY, "ls_voting_intention"])


def test_segment_fields_are_named():
    assert SEGMENT_FIELDS == {"ac_type", "ac_score", "pc_type", "pc_score"}
