"""Filter value lists: one engine distribution job cut by the field (spec 7.3, plan amendment)."""

from __future__ import annotations

from matbodh_dashboard.cards.configure.values import FilterValues, compile_values, translate_values
from tests.cards.test_configure_options import PRESET, R1, R2, R3, R4, catalogue, ctx


def compile_(field="caste", scenario=None, pipe_rounds=None, cat=None, context=None):
    return compile_values(field, scenario, context or ctx(), cat or catalogue(), PRESET, pipe_rounds)


def only_job(plan):
    assert plan.unavailable == (), plan.unavailable
    (job,) = plan.jobs
    assert (job.key, job.kind, job.part) == ("values", "analysis", "values")
    return job.config


def test_values_job_config():
    config = only_job(compile_())
    request = config["request"]
    assert request["grouping_sets"] == [["caste"]]
    assert request["caste_clubbing"] is None and request["filters"] == [] and request["display_parties"] == []
    assert request["comparisons"] == [] and request["parties"]["other_grouping"] is None
    assert [o["id"] for o in request["observations"]] == ["o1", "o2", "o3", "o4"]
    assert request["scenarios"] == ["mla_choice_party"]  # the first party scenario the anchor round asked


def test_values_uses_card_scenario_first():
    request = only_job(compile_(scenario="vs_voting_intention"))["request"]
    assert request["scenarios"] == ["vs_voting_intention"]


def test_values_follow_the_pipe_round_window():
    request = only_job(compile_(pipe_rounds=2))["request"]
    assert [o["id"] for o in request["observations"]] == ["o3", "o4"]


def test_values_drops_rounds_not_asking_scenario():
    plan = compile_(cat=catalogue(missing={3: ["mla_choice_party"]}))
    request = only_job(plan)["request"]
    assert [o["id"] for o in request["observations"]] == ["o1", "o2", "o4"]
    assert plan.not_asked == (("values", (R3,)),)


def test_a_scenario_no_round_asked_is_unavailable():
    plan = compile_(scenario="cm_choice_party", cat=catalogue(missing={i: ["cm_choice_party"] for i in range(1, 5)}))
    assert plan.jobs == () and any("cm_choice_party" in reason for _, reason in plan.unavailable)


def test_unknown_and_seat_type_fields_are_unavailable():
    for field in ("not_a_field", "ac_type", "state"):
        plan = compile_(field)
        assert plan.jobs == () and any(field in reason for _, reason in plan.unavailable), field


def test_field_missing_in_a_read_round_is_unavailable_with_the_round():
    plan = compile_(cat=catalogue(fields_missing={2: ["caste"]}))
    assert plan.jobs == () and any("caste" in reason and R2 in reason for _, reason in plan.unavailable)


def test_a_master_field_is_available_in_every_round():
    assert only_job(compile_("party_zone"))["request"]["grouping_sets"] == [["party_zone"]]


def rows(*values, set_id="g0"):
    return {"rows": [{"grouping_set_id": set_id,
                      "dimensions": {"caste": {"value": v, "is_subtotal": v is None}}} for v in values]}


def test_translate_values_distinct_sorted_no_null():
    result = translate_values(rows("g10", "g2", None, "g2", "Brahmin", "g1"), "caste")
    assert result == FilterValues(kind="filter_values", field="caste", values=["Brahmin", "g1", "g2", "g10"])


def test_translate_values_ignores_other_grouping_sets_and_missing_dimensions():
    result = translate_values({"rows": [*rows("a", set_id="g1")["rows"], {"grouping_set_id": "g0", "dimensions": {}},
                                        *rows("b")["rows"]]}, "caste")
    assert result.values == ["b"]


def test_translate_values_of_an_empty_result_is_empty():
    assert translate_values({"rows": []}, "caste").values == []
