from pathlib import Path

import pytest

from matbodh_dashboard.cards.compile import compile_card
from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import load_preset
from tests.compiler.engine_stub import resolve_with_engine
from tests.fixtures.catalogue_rows import SCENARIOS, dataset_row, level_row, make_query

ROOT = Path(__file__).resolve().parents[2]
PRESET = load_preset(ROOT / "config/presets/uttar-pradesh.standard-v1.yaml")
STATE = "Uttar Pradesh"
R1, R2, R3 = (f"2027 VS CAPI R{i}" for i in (1, 2, 3))
FIELDS = ["age_group", "gender", "ac_num", "pc_num", "party_zone", "category", "caste"]
VS, LS, PM, CM = "vs_voting_intention", "ls_past", "pm_satisfaction", "cm_satisfaction"


def _catalogue(level="ac", rounds=3):
    names = [f"2027 VS CAPI R{i}" for i in range(1, rounds + 1)]
    rows, levels = [], []
    for i, name in enumerate(names, 1):
        # R1 did not ask cm_satisfaction (see tests.fixtures.catalogue_rows).
        scenarios = [s for s in [*SCENARIOS, LS] if i > 1 or s != CM]
        rows.append(dataset_row(name, round_number=i, level=level, available_fields=FIELDS,
                                available_scenarios=scenarios))
        levels.append(level_row(name, range(1, 381 if i == 1 else 404)))
    return load_catalogue(make_query(rows, levels))


def _ctx(rounds=(R1, R2, R3), level="ac", compare=R1, **kw):
    return StateContext(state=STATE, level=level, rounds=list(rounds), compare_round=compare, **kw)


def _config(**overrides) -> CardConfig:
    data = {"id": "c1", "family": "distribution", "section": "cards", "title": "T",
            "scenarios": [VS]}
    data.update(overrides)
    return CardConfig.model_validate(data)


def _compile(config, ctx=None, level="ac", rounds=3):
    ctx = ctx or _ctx(level=level)
    return compile_card(config, ctx, _catalogue(level, rounds), PRESET)


def _request(plan):
    assert plan.unavailable == (), plan.unavailable
    (job,) = plan.jobs
    return job.config["request"]


def test_standalone_uses_anchor_round_only():
    plan = _compile(_config(cuts=[[], ["age_group"]]))
    (job,) = plan.jobs
    assert (job.key, job.part, job.kind) == ("grid", "grid", "analysis")
    request = job.config["request"]
    assert request["observations"] == [{"id": "o3", "survey_name": R3}]
    assert request["comparisons"] == []
    assert request["coverage_mode"] == "independent"
    assert request["grouping_sets"] == [[], ["age_group"]]
    assert request["scenarios"] == [VS]
    assert request["weights"] == {"mode": "mj_cap", "invalid": "exclude", "zero": "include"}
    assert plan.anchor == R3 and plan.compare == R1 and plan.unavailable == ()
    assert [r.obs_id for r in plan.rounds] == ["o1", "o2", "o3"]


def test_compare_inter_round():
    plan = _compile(_config(comparison={
        "mode": "compare", "target": {"scenario": VS},
        "reference": {"round": "compare", "scenario": VS}}))
    request = _request(plan)
    assert [o["id"] for o in request["observations"]] == ["o1", "o3"]
    assert request["comparisons"] == [{
        "id": "d-vs_voting_intention-o3-o1", "target": ["o3", VS], "reference": ["o1", VS],
        "measure": "support_share", "kind": "difference"}]


def test_compare_intra_round():
    plan = _compile(_config(comparison={
        "mode": "compare", "target": {"scenario": VS}, "reference": {"scenario": LS}}))
    request = _request(plan)
    assert [o["id"] for o in request["observations"]] == ["o3"]
    assert request["scenarios"] == [VS, LS]
    (comparison,) = request["comparisons"]
    assert comparison["target"] == ["o3", VS] and comparison["reference"] == ["o3", LS]
    assert comparison["kind"] == "difference"


def test_compare_party_vs_opinion_is_shakti():
    plan = _compile(_config(comparison={
        "mode": "compare", "target": {"scenario": VS}, "reference": {"scenario": PM}}))
    (comparison,) = _request(plan)["comparisons"]
    assert comparison["kind"] == "shakti"
    assert comparison["target"] == ["o3", VS] and comparison["reference"] == ["o3", PM]


def test_opinion_compare_emits_one_comparison_per_delta_measure():
    plan = _compile(_config(family="opinion", comparison={
        "mode": "compare", "target": {"scenario": PM},
        "reference": {"round": "compare", "scenario": PM},
        "delta_measures": ["net_score", "positive_share"]}))
    comparisons = _request(plan)["comparisons"]
    assert [c["measure"] for c in comparisons] == ["net_score", "positive_share"]
    assert len({c["id"] for c in comparisons}) == 2
    assert all(c["kind"] == "difference" for c in comparisons)


def test_seat_level_compare_chooses_common_coverage():
    compare = {"mode": "compare", "target": {"scenario": VS},
               "reference": {"round": "compare", "scenario": VS}}
    seat = _request(_compile(_config(cuts=[["ac_num"]], comparison=compare)))
    assert seat["coverage_mode"] == "common" and seat["reference_observation"] == "o1"
    demographic = _request(_compile(_config(cuts=[["age_group"]], comparison=compare)))
    assert demographic["coverage_mode"] == "independent"
    assert demographic["reference_observation"] is None


def test_trend_drops_round_missing_scenario():
    plan = _compile(_config(family="opinion", scenarios=[CM], comparison={"mode": "trend"}))
    request = _request(plan)
    assert [o["id"] for o in request["observations"]] == ["o2", "o3"]
    assert request["comparisons"] == [] and request["coverage_mode"] == "independent"
    assert plan.not_asked == (("grid", (R1,)),)
    assert plan.unavailable == ()


def test_trend_needs_two_asked_rounds():
    plan = _compile(_config(family="opinion", scenarios=[CM], comparison={"mode": "trend"}),
                    ctx=_ctx(rounds=(R1, R3)))
    assert plan.jobs == () and "at least 2" in plan.unavailable[0][1]


def test_trend_rejects_more_than_four_rounds():
    names = [f"2027 VS CAPI R{i}" for i in range(1, 6)]
    plan = _compile(_config(comparison={"mode": "trend"}), ctx=_ctx(rounds=names), rounds=5)
    assert plan.jobs == () and "at most 4" in plan.unavailable[0][1]


def test_missing_field_is_unavailable_with_names():
    plan = _compile(_config(cuts=[["no_such_field"]]))
    assert plan.jobs == ()
    reason = plan.unavailable[0][1]
    assert "no_such_field" in reason and R3 in reason


def test_compare_endpoint_scenario_not_asked_is_unavailable():
    plan = _compile(_config(family="opinion", scenarios=[], comparison={
        "mode": "compare", "target": {"scenario": CM},
        "reference": {"round": "compare", "scenario": CM}}))
    assert plan.jobs == ()
    reason = plan.unavailable[0][1]
    assert CM in reason and R1 in reason


def test_compare_without_compare_round_is_unavailable():
    plan = _compile(_config(comparison={
        "mode": "compare", "target": {"scenario": VS},
        "reference": {"round": "compare", "scenario": VS}}), ctx=_ctx(compare=None))
    assert plan.jobs == () and "comparison round" in plan.unavailable[0][1]


def test_geographic_cut_blocked_at_pc_level():
    plan = _compile(_config(cuts=[["party_zone"]]), level="pc")
    assert plan.jobs == () and "party_zone" in plan.unavailable[0][1]


def test_caste_clubbing_reference_is_anchor_in_standalone_and_reference_in_compare():
    cuts = [[], ["category", "caste"]]
    standalone = _request(_compile(_config(cuts=cuts, caste_clubbing=True)))
    assert standalone["caste_clubbing"] == {"threshold_pct": 0.5, "reference_observation": "o3"}
    compare = _request(_compile(_config(cuts=cuts, caste_clubbing=True, comparison={
        "mode": "compare", "target": {"scenario": VS},
        "reference": {"round": "compare", "scenario": VS}})))
    assert compare["caste_clubbing"] == {"threshold_pct": 0.5, "reference_observation": "o1"}


def test_filters_are_passed_as_engine_filters():
    config = _config(filters=[{"field": "party_zone", "operator": "not_in", "values": ["A", "B"]}])
    assert _request(_compile(config))["filters"] == [
        {"field": "party_zone", "operator": "not_in", "values": ["A", "B"]}]


def test_gender_differential_request_has_gender_block_and_no_gender_cut():
    config = _config(family="gender_differential", cuts=[[], ["party_zone"]])
    request = _request(_compile(config))
    assert request["gender_differential"] == {
        "field": "gender", "female_values": ["Female"], "male_values": ["Male"]}
    assert all("gender" not in grouping for grouping in request["grouping_sets"])


def test_distribution_request_has_no_gender_block():
    assert _request(_compile(_config()))["gender_differential"] is None


CONFIGS = {
    "standalone_caste": dict(cuts=[[], ["category", "caste"]], caste_clubbing=True),
    "inter_round": dict(comparison={"mode": "compare", "target": {"scenario": VS},
                                    "reference": {"round": "compare", "scenario": VS}}),
    "intra_round": dict(comparison={"mode": "compare", "target": {"scenario": VS},
                                    "reference": {"scenario": LS}}),
    "shakti": dict(comparison={"mode": "compare", "target": {"scenario": VS},
                               "reference": {"scenario": PM}}),
    "seat_level": dict(cuts=[["ac_num"]], comparison={
        "mode": "compare", "target": {"scenario": VS},
        "reference": {"round": "compare", "scenario": VS}}),
    "opinion_compare": dict(family="opinion", scenarios=[], comparison={
        "mode": "compare", "target": {"scenario": PM},
        "reference": {"round": "compare", "scenario": PM},
        "delta_measures": ["net_score", "negative_share"]}),
    "trend": dict(comparison={"mode": "trend"}),
    "gender": dict(family="gender_differential", cuts=[[], ["party_zone"]]),
    "filtered": dict(filters=[{"field": "gender", "values": ["Female"]}]),
}


@pytest.mark.parametrize("name", sorted(CONFIGS))
def test_compiled_requests_are_accepted_by_the_engine(name):
    plan = _compile(_config(**CONFIGS[name]))
    request = _request(plan)
    resolve_with_engine(request, list(plan.rounds))


# -- per-card pipe rounds (spec section 4) ------------------------------------------------------


def _long_catalogue(count, lacking=None):
    """`count` rounds; `lacking` maps a round number to the scenario that round did not ask."""
    rows, levels = [], []
    for i in range(1, count + 1):
        scenarios = [s for s in [*SCENARIOS, LS] if s != (lacking or {}).get(i)]
        name = f"2027 VS CAPI R{i}"
        rows.append(dataset_row(name, round_number=i, available_fields=FIELDS, available_scenarios=scenarios))
        levels.append(level_row(name, range(1, 404)))
    return load_catalogue(make_query(rows, levels))


def _trend(count, pipe_rounds, lacking=None):
    names = [f"2027 VS CAPI R{i}" for i in range(1, count + 1)]
    config = _config(comparison={"mode": "trend"}, pipe_rounds=pipe_rounds)
    return compile_card(config, _ctx(rounds=names, compare=None), _long_catalogue(count, lacking), PRESET)


def test_trend_pipe_rounds_window_then_not_asked():
    plan = _trend(4, 3, lacking={3: VS})
    assert plan.unavailable == () and plan.notes == ()
    (job,) = plan.jobs
    assert [o["id"] for o in job.config["request"]["observations"]] == ["o2", "o4"]
    assert plan.not_asked == (("grid", ("2027 VS CAPI R3",)),)
    assert [r.obs_id for r in plan.rounds] == ["o2", "o3", "o4"]  # only the window is listed


def test_trend_without_pipe_rounds_reads_every_context_round():
    plan = _trend(3, None)
    assert [r.obs_id for r in plan.rounds] == ["o1", "o2", "o3"] and plan.notes == ()


def test_trend_window_shorter_than_asked_adds_a_note():
    plan = _trend(3, 5)
    assert plan.notes == ("showing 3 of the 5 rounds asked for",)
    assert [r.obs_id for r in plan.rounds] == ["o1", "o2", "o3"]


def test_trend_window_above_max_is_unavailable():
    plan = _trend(5, 5)
    assert plan.jobs == ()
    assert plan.unavailable == (("grid", "Trend shows at most 4 rounds; 5 are selected"),)


def test_compare_round_outside_the_window_is_dropped_from_the_plan():
    names = [f"2027 VS CAPI R{i}" for i in range(1, 5)]
    config = _config(comparison={"mode": "trend"}, pipe_rounds=2)
    plan = compile_card(config, _ctx(rounds=names, compare=names[0]), _long_catalogue(4), PRESET)
    assert plan.compare is None  # R1 is not among the rounds this card reads


# -- hide parties (spec 5.1) --------------------------------------------------------------------


def test_display_parties_emitted():
    request = _request(_compile(_config(display_parties=["NDA", "Other"])))
    assert request["display_parties"] == ["NDA", "Other"]
    gender = _request(_compile(_config(family="gender_differential", display_parties=["NDA"])))
    assert gender["display_parties"] == ["NDA"]


def test_display_parties_default_is_every_party():
    assert _request(_compile(_config()))["display_parties"] == []


def test_display_parties_unknown_party_unavailable():
    plan = _compile(_config(display_parties=["NDA", "XYZ"]))  # not in preset.keep + Other
    assert plan.jobs == ()
    assert any("XYZ" in reason for _, reason in plan.unavailable)
