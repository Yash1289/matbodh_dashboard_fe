"""Filter values without an engine run: one SELECT DISTINCT over the response table, through the reporting mapping."""

from __future__ import annotations

import pytest

from matbodh_dashboard.cards.configure.distinct_values import (
    MAX_VALUES, DistinctUnavailable, distinct_values, rounds_read)
from tests.cards.test_configure_options import R1, R2, R3, R4, catalogue, ctx


class Recorder:
    """A fake read-only query function: replies with the given values and remembers every call."""

    def __init__(self, values=("30-39",)):
        self.values, self.calls = list(values), []

    def __call__(self, sql, params):
        self.calls.append((sql, params))
        return [(v,) for v in self.values]


def run(field="age_group", mode="standalone", rec=None, cat=None, context=None, pipe_rounds=None):
    rec = rec or Recorder()
    return distinct_values(field, context or ctx(), mode, pipe_rounds, cat or catalogue(), rec), rec


def test_one_distinct_query_over_the_valid_responses_of_the_included_rounds():
    found, rec = run(rec=Recorder(["Male", "Female", "Male", "", None]))
    assert (found.source, found.values) == ("responses", ["Female", "Male"])
    (sql, params), = rec.calls  # one query, no metadata round trips
    assert "SELECT DISTINCT" in sql and "FROM warehouse.sra_v2_survey_responses_rmt AS response FINAL" in sql
    assert "`final_valid` = 1" in sql and "`status` = 1" in sql and "survey_dataset_levels" in sql
    assert params["state"] == "Uttar Pradesh" and len(params["dataset_ids"]) == 1  # standalone: the anchor round


def test_the_value_goes_through_the_reporting_mapping_like_the_engine_projection():
    _, rec = run(field="caste")
    sql = rec.calls[0][0]
    assert ("ifNull(dictGetOrNull('warehouse.reporting_value_mapping_dict_v2', 'value_reporting', "
            "(response.`state`, 'caste', '', ifNull(toString(response.`caste`), ''), '', '', '')), "
            "response.`caste`)") in sql  # an unmapped answer stays as it is


def test_values_are_in_natural_order():
    found, _ = run(rec=Recorder(["10th Pass", "8th Pass", "12th Pass"]))
    assert found.values == ["8th Pass", "10th Pass", "12th Pass"]


def test_each_mode_reads_only_its_rounds():
    names = lambda mode, **kw: [r.identity.base_name for r in rounds_read(mode, ctx(), catalogue(), kw.get("pipe_rounds"))]  # noqa: E731
    assert names("standalone") == [R4]
    assert names("compare") == [R1, R4]  # the anchor and the comparison round
    assert names("trend") == [R1, R2, R3, R4]
    assert names("trend", pipe_rounds=2) == [R3, R4]
    assert names(None) == [R1, R2, R3, R4]


def test_compare_without_a_comparison_round_reads_the_anchor_alone():
    assert [r.identity.base_name for r in rounds_read("compare", ctx(compare=None), catalogue(), None)] == [R4]


def test_a_field_missing_from_an_unread_round_is_fine_but_not_from_a_read_one():
    cat = catalogue(fields_missing={1: ["age_group"]})  # R1 lacks it
    assert run(cat=cat, mode="standalone")[0].values == ["30-39"]
    with pytest.raises(DistinctUnavailable, match=rf"missing in: {R1}"):
        run(cat=cat, mode="compare")
    with pytest.raises(DistinctUnavailable, match=rf"missing in: {R1}"):
        run(cat=cat, mode="trend")


def test_trend_checks_the_pipe_window_only():
    cat = catalogue(fields_missing={1: ["age_group"]})
    assert run(cat=cat, mode="trend", pipe_rounds=2)[0].values == ["30-39"]  # R3 and R4 only


def test_an_unknown_field_is_refused_with_the_reason():
    with pytest.raises(DistinctUnavailable, match="cannot be used in a filter"):
        run(field="not_a_field")


def test_a_field_outside_the_response_table_is_left_to_the_engine():
    found, rec = run(field="incumbent_mla_party")
    assert (found.source, found.values, rec.calls) == ("engine", [], [])


def test_a_field_with_too_many_values_is_refused():
    many = [f"v{i}" for i in range(MAX_VALUES + 1)]
    with pytest.raises(DistinctUnavailable, match="cannot be used as a filter list"):
        run(rec=Recorder(many))


def test_table_names_are_checked_before_they_reach_sql():
    with pytest.raises(ValueError, match="Unsupported table identifier"):
        distinct_values("age_group", ctx(), "standalone", None, catalogue(), Recorder(),
                        sources={"mapping_dictionary": "warehouse.m; DROP TABLE x", "response_table": "warehouse.r"})
