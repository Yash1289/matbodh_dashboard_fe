from pathlib import Path

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
        "opinion_weights": None,
        "caste_clubbing": None,
        "gender_differential": {"field": "gender", "female_values": ["Female"],
                                "male_values": ["Male"]},
    }


def test_common_sets_reference_to_latest_round():
    assert _request(coverage_mode="common")["reference_observation"] == "o2"


def test_no_other_grouping():
    assert _request(other_grouping=False)["parties"]["other_grouping"] is None


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
