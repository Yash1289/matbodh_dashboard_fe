"""Configure option lists: real metadata for the rounds the draft card reads (spec 7)."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from matbodh_dashboard.cards.benchmark.parties import ElectionOption
from matbodh_dashboard.cards.config import SEGMENT_FIELDS
from matbodh_dashboard.cards.configure.options import options_for, rounds_read
from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import load_preset
from tests.fixtures.catalogue_rows import dataset_row, level_row, make_query

ROOT = Path(__file__).resolve().parents[2]
PRESET = load_preset(ROOT / "config/presets/uttar-pradesh.standard-v1.yaml")
STATE = "Uttar Pradesh"
NAMES = [f"2027 VS CAPI R{i}" for i in range(1, 5)]
R1, R2, R3, R4 = NAMES
FIELDS = ["age_group", "gender", "caste", "category", "ac_num", "pc_num"]
SCENARIOS = ["vs_voting_intention", "vs_past", "cm_choice_party", "mla_choice_party", "pm_satisfaction",
             "cm_satisfaction", "made_up_scenario"]


class FakeParties:
    def identities(self, state, reporting_type, *, year=None, election_type=None):
        if year is None:
            return frozenset({"NDA", "SP+", "BSP"})
        return frozenset({"NDA", "SP+", "BSP", "INDI"})  # 2022 VS also maps INDI


def catalogue(level="ac", missing=None, fields_missing=None):
    """Four rounds; `missing` / `fields_missing` map a round number to scenarios / fields it lacks."""
    rows, levels = [], []
    for i, name in enumerate(NAMES, 1):
        scenarios = [s for s in SCENARIOS if s not in (missing or {}).get(i, ())]
        fields = [f for f in FIELDS if f not in (fields_missing or {}).get(i, ())]
        rows.append(dataset_row(name, round_number=i, level=level, available_fields=fields,
                                available_scenarios=scenarios))
        levels.append(level_row(name, range(1, 404)))
    return load_catalogue(make_query(rows, levels))


def service(cat=None):
    return SimpleNamespace(catalogue=cat or catalogue(), preset=PRESET, major_parties=FakeParties(),
                           elections={STATE: [ElectionOption(year=2022, election_type="VS", label="2022 VS")]})


def ctx(level="ac", compare=R1, rounds=NAMES):
    return StateContext(state=STATE, level=level, rounds=list(rounds), compare_round=compare)


def items(source, draft=None, svc=None, context=None, **params):
    return options_for(source, params, draft or {}, context or ctx(), svc or service())


def values(found):
    return [i.value for i in found if i.disabled_reason is None]


def test_party_scenarios_follow_q11():
    found = {i.value: i for i in items("scenarios", kind="party")}
    assert set(found) == {"vs_voting_intention", "vs_past", "mla_choice_party"}  # no cm_choice_party (Q-11)
    assert found["vs_past"].kind == "party" and found["vs_past"].recalled is True
    assert found["vs_voting_intention"].recalled is False


def test_opinion_and_any_scenarios_and_unknown_ids_skipped():
    assert values(items("scenarios", kind="opinion")) == ["cm_satisfaction", "pm_satisfaction"]
    any_kind = values(items("scenarios", kind="any"))
    assert "pm_satisfaction" in any_kind and "vs_past" in any_kind and "made_up_scenario" not in any_kind


def test_scenario_not_in_every_round_disabled_for_all_read():
    draft = {"family": "opinion", "comparison": {"mode": "trend"}}
    found = {i.value: i for i in items("scenarios", draft, service(catalogue(missing={1: ["cm_satisfaction"]})),
                                       kind="opinion", scope="all_read")}
    assert R1 in found["cm_satisfaction"].disabled_reason
    assert found["pm_satisfaction"].disabled_reason is None


def test_rounds_read_follows_mode_and_window():
    cat = catalogue()

    def read(draft):
        return [r.identity.base_name for r in rounds_read(draft, ctx(), cat)]

    assert read({"family": "distribution"}) == [R4]
    assert read({"family": "distribution", "comparison": {
        "mode": "compare", "target": {"round": "anchor"}, "reference": {"round": "compare"}}}) == [R1, R4]
    assert read({"family": "distribution", "comparison": {"mode": "compare"}}) == [R4]  # both default to anchor
    assert read({"family": "distribution", "comparison": {"mode": "trend"}, "pipe_rounds": 2}) == [R3, R4]
    assert read({"family": "distribution", "comparison": {"mode": "trend"}}) == NAMES
    assert read({"family": "relationship", "pipe_rounds": 2}) == [R3, R4]
    assert read({"family": "seat_benchmark"}) == [R1, R4]  # the default reference is the comparison round
    assert read({"family": "seat_benchmark", "benchmark": {"reference": {"kind": "none"}}}) == [R4]


def test_trend_drops_rounds_that_did_not_ask_the_scenario():
    cat = catalogue(missing={3: ["vs_voting_intention"]})
    draft = {"family": "distribution", "scenarios": ["vs_voting_intention"], "comparison": {"mode": "trend"}}
    assert [r.identity.base_name for r in rounds_read(draft, ctx(), cat)] == [R1, R2, R4]


def test_field_missing_in_a_windowed_round_is_disabled_with_that_round():
    draft = {"family": "distribution", "comparison": {"mode": "trend"}, "pipe_rounds": 2}
    found = {i.value: i for i in items("fields", draft, service(catalogue(fields_missing={3: ["caste"]})), use="cut")}
    assert R3 in found["caste"].disabled_reason
    assert found["age_group"].disabled_reason is None


def test_fields_respect_capabilities():
    ac = values(items("fields", {"family": "distribution"}, use="cut"))
    assert {"ac_num", "pc_num", "party_zone", "gender", "caste"} <= set(ac) and "state" not in ac
    gd = values(items("fields", {"family": "gender_differential"}, use="cut", family="gender_differential"))
    assert "gender" not in gd and "caste" in gd
    pc = values(items("fields", {"family": "distribution"}, service(catalogue("pc")), ctx("pc"), use="cut"))
    assert "ac_num" not in pc and "party_zone" not in pc and "pc_num" in pc and "pc_zone" in pc


def test_level_and_partition_and_seat_attributes():
    level = values(items("fields", {"family": "demographic_ranking"}, use="level"))
    assert "caste" in level and "ac_num" not in level and "party_zone" not in level
    partition = values(items("fields", {"family": "demographic_ranking"}, use="partition"))
    assert "ac_num" in partition and "party_zone" in partition and "caste" not in partition
    seats = values(items("fields", {"family": "seat_ranking", "rank": {"level": "ac"}}, use="seat_attribute"))
    assert "party_zone" in seats and "incumbent_mla_party" in seats and "caste" not in seats
    pc_seats = values(items("fields", {"family": "seat_ranking", "rank": {"level": "pc"}}, use="seat_attribute"))
    assert "pc_zone" in pc_seats and "incumbent_mp_party" in pc_seats
    assert "incumbent_mla_party" not in pc_seats and "party_zone" not in pc_seats


@pytest.mark.parametrize("use", ["cut", "filter", "level", "partition", "seat_attribute"])
def test_seat_attributes_exclude_seat_type(use):
    for draft in ({"family": "seat_ranking", "rank": {"level": "ac"}}, {"family": "seat_ranking", "rank": {"level": "pc"}}):
        assert not set(i.value for i in items("fields", draft, use=use)) & SEGMENT_FIELDS


def test_joint_weight_scenarios_need_embedded_weights_in_every_round():
    draft = {"family": "relationship", "relationship": {"origin": "vs_past", "destination": "vs_voting_intention"}}
    found = {i.value: i for i in items("joint_weight_scenarios", draft,
                                       service(catalogue(missing={2: ["mla_choice_party"]})))}
    assert "vs_past" not in found and "pm_satisfaction" not in found  # no weights of their own
    assert found["vs_voting_intention"].disabled_reason is None
    assert R2 in found["mla_choice_party"].disabled_reason


def test_metrics_follow_the_scenario_or_compare_target():
    assert values(items("metrics", {"scenarios": ["vs_voting_intention"]})) == ["support_share"]
    assert values(items("metrics", {"scenarios": ["pm_satisfaction"]})) == [
        "net_score", "positive_share", "negative_share"]
    compare = {"comparison": {"mode": "compare", "target": {"scenario": "vs_voting_intention"}}}
    assert values(items("metrics", compare)) == ["support_share"]
    assert items("metrics", {}) == []


def test_parties_hide_is_preset_keep_plus_other():
    assert values(items("parties", use="hide")) == [*PRESET.keep, PRESET.other_label]


def test_parties_rank_is_preset_keep():
    assert values(items("parties", use="rank")) == PRESET.keep


def test_parties_focal_benchmark_depends_on_reference():
    survey = items("parties", {"family": "seat_benchmark"}, use="focal")
    assert values(survey) == ["BSP", "NDA", "SP+"]
    draft = {"family": "seat_benchmark", "benchmark": {"reference": {"kind": "election", "year": 2022,
                                                                     "election_type": "VS"}}}
    focal = {i.value: i for i in items("parties", draft, use="focal")}
    assert "not mapped for every endpoint" in focal["INDI"].disabled_reason  # the survey has no INDI
    assert focal["NDA"].disabled_reason is None
    assert values(items("parties", draft, use="contenders")) == ["BSP", "INDI", "NDA", "SP+"]


def test_relationship_focal_is_the_survey_mapping():
    assert values(items("parties", {"family": "relationship"}, use="focal")) == ["BSP", "NDA", "SP+"]


def test_elections_offer_nothing_the_comparison_round_and_past_elections():
    found = items("elections")
    assert [i.value for i in found] == ["none", "compare", "election:2022:VS"]
    assert found[2].label == "2022 VS"
    no_compare = items("elections", context=ctx(compare=None))
    assert no_compare[1].disabled_reason is not None


def test_unknown_source_raises_key_error():
    with pytest.raises(KeyError):
        items("nope")
