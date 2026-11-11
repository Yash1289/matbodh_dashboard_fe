from pathlib import Path

import pytest

from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.compiler.requests import build_request, comparison, view_config
from matbodh_dashboard.compiler.rounds import resolve_rounds
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import load_preset
from tests.compiler.engine_stub import resolve_with_engine
from tests.fixtures.catalogue_rows import make_query

PRESET = load_preset(
    Path(__file__).resolve().parents[2] / "config/presets/uttar-pradesh.standard-v1.yaml"
)


def _rounds():
    ctx = StateContext(state="Uttar Pradesh", level="ac",
                       rounds=["2027 VS CAPI R1", "2027 VS CAPI R2"])
    return resolve_rounds(ctx, load_catalogue(make_query()))


def _request(**kw):
    rounds = _rounds()
    o1, o2 = rounds
    return build_request(
        state="Uttar Pradesh", rounds=rounds, scenarios=["vs_voting_intention"],
        grouping_sets=[[]], preset=PRESET,
        comparisons=[comparison(o2, o1, "vs_voting_intention")], gender=True, **kw)


def test_scoreboard_request_snapshot():
    assert _request() == {
        "id": "dashboard",
        "state": "Uttar Pradesh",
        "observations": [
            {"id": "o1", "survey_name": "2027 VS CAPI R1"},
            {"id": "o2", "survey_name": "2027 VS CAPI R2 (Extrapolated)"},
        ],
        "scenarios": ["vs_voting_intention"],
        "grouping_sets": [[]],
        "weights": {"mode": "mj_cap", "invalid": "exclude", "zero": "include"},
        "answers": {"excluded": [""], "strip_whitespace": True,
                    "policy_id": "all_answered_options"},
        "parties": {"passthrough": True, "options": [],
                    "other_grouping": {"keep": ["NDA", "SP+", "BSP"], "label": "Other"}},
        "geography_path": "ac_hierarchy",
        "filters": [],
        "display_parties": [],
        "comparisons": [{
            "id": "d-vs_voting_intention-o2-o1",
            "target": ["o2", "vs_voting_intention"],
            "reference": ["o1", "vs_voting_intention"],
            "measure": "support_share", "kind": "difference"}],
        "reference_observation": None,
        "coverage_mode": "independent",
        "opinion_weights": {"source": "base"},
        "caste_clubbing": None,
        "gender_differential": {"field": "gender", "female_values": ["Female"],
                                "male_values": ["Male"]},
    }


def test_common_sets_reference_to_latest_round():
    assert _request(coverage_mode="common")["reference_observation"] == "o2"


def test_keep_overrides_the_preset_keep_list():
    other = _request(keep=["INDI", "NDA"])["parties"]["other_grouping"]
    assert other == {"keep": ["INDI", "NDA"], "label": "Other"}


def test_no_other_grouping():
    assert _request(other_grouping=False)["parties"]["other_grouping"] is None


def test_defaults_leave_filters_clubbing_and_reference_empty():
    request = _request()
    assert request["filters"] == []
    assert request["caste_clubbing"] is None
    assert request["reference_observation"] is None


def test_build_request_passes_filters_and_caste_clubbing():
    filters = [{"field": "party_zone", "operator": "in", "values": ["Jat Belt"]}]
    clubbing = {"threshold_pct": 0.5, "reference_observation": "o2"}
    request = _request(filters=filters, caste_clubbing=clubbing)
    assert request["filters"] == filters
    assert request["caste_clubbing"] == clubbing


def test_explicit_reference_observation_wins():
    assert _request(coverage_mode="common", reference_observation="o1")[
        "reference_observation"] == "o1"
    assert _request(reference_observation="o1")["reference_observation"] == "o1"


def test_comparison_kind_is_emitted():
    o1, o2 = _rounds()
    assert comparison(o2, o1, "vs_voting_intention", kind="shakti")["kind"] == "shakti"
    assert comparison(o2, o1, "vs_voting_intention")["kind"] == "difference"


def test_comparison_can_pair_two_scenarios_in_one_round():
    o1, o2 = _rounds()
    c = comparison(o2, o2, "vs_voting_intention", reference_scenario="ls_past")
    assert c["target"] == ["o2", "vs_voting_intention"]
    assert c["reference"] == ["o2", "ls_past"]


def test_comparison_ids_are_unique_per_measure_and_scenario_pair():
    o1, o2 = _rounds()
    ids = {
        comparison(o2, o1, "pm_satisfaction", "net_score")["id"],
        comparison(o2, o1, "pm_satisfaction", "positive_share")["id"],
        comparison(o2, o2, "vs_voting_intention", reference_scenario="ls_past")["id"],
        comparison(o2, o1, "vs_voting_intention")["id"],
    }
    assert len(ids) == 4
    assert comparison(o2, o1, "vs_voting_intention")["id"] == "d-vs_voting_intention-o2-o1"


def test_view_config_sources_and_alliances():
    cfg = view_config(_request(), PRESET, ranking=None)
    assert cfg["sources"] == {
        "response_table": "warehouse.sra_v2_survey_responses_rmt",
        "factor_dictionary": "warehouse.ac_population_factor_dict_v2",
        "mapping_dictionary": "warehouse.reporting_value_mapping_dict_v2",
        "mapping_table": "warehouse.reporting_value_mapping",
    }
    assert cfg["alliances"] == {"reporting_type": "MatBodh"}
    assert cfg["request"]["id"] == "dashboard" and cfg["ranking"] is None


def test_request_accepted_by_engine():
    request = _request(coverage_mode="common")
    contract = resolve_with_engine(request, _rounds())
    assert contract["coverage_acs"] == tuple(range(1, 381))


def test_independent_request_accepted_by_engine():
    contract = resolve_with_engine(_request(), _rounds())
    assert contract["coverage_acs"] == ()


def test_request_without_other_grouping_accepted_by_engine():
    request = _request(other_grouping=False)
    assert request["parties"]["other_grouping"] is None
    resolve_with_engine(request, _rounds())


def test_engine_rejects_scenario_missing_from_dataset():
    request = _request()
    request["scenarios"] = ["cm_preference"]
    request["comparisons"] = []
    request["gender_differential"] = None
    with pytest.raises(ValueError, match="Unverified scenario availability"):
        resolve_with_engine(request, _rounds())
