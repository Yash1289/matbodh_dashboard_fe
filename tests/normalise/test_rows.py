from matbodh_dashboard.normalise.rows import NormalRow, from_analysis, from_benchmark
from tests.fixtures.engine_results import analysis_result, benchmark_result


def pick(rows, measure, series=None, obs=None):
    out = [r for r in rows if r.measure == measure
           and (series is None or r.series == series) and (obs is None or r.obs_id == obs)]
    assert len(out) == 1, out
    return out[0]


def test_support_rows_keep_base():
    rows = from_analysis(analysis_result(), "Uttar Pradesh")
    r = pick(rows, "support_share", "BJP")
    assert (r.state, r.obs_id, r.value, r.unit, r.base) == ("Uttar Pradesh", "obs1", 41.5, "pct", 812.25)
    assert r.flags == frozenset() and r.scenario == "vote"
    assert not [x for x in rows if x.obs_id == "obs_dead"]
    assert isinstance(r, NormalRow)


def test_opinion_rows_use_option_id_and_stay_distinct_by_scenario():
    rows = [r for r in from_analysis(analysis_result(), "UP")
            if r.measure == "support_share" and r.series == "Completely Satisfied"]
    assert {(r.scenario, r.value) for r in rows} == {("pm_satisfaction", 20.0),
                                                       ("cm_satisfaction", 12.0)}


def test_comparison_rows_use_engine_delta():
    rows = from_analysis(analysis_result(), "UP")
    r = pick(rows, "delta_support", "BJP")
    assert r.value == 5.0 and r.value != 41.5 - 33.0
    assert r.obs_id == "obs1" and r.unit == "pp"
    assert r.scenario == "vote" and r.flags == frozenset()
    n = pick(rows, "delta_net_score")
    assert (n.series, n.obs_id, n.value, n.scenario) == ("approval", "obs2", -4.0, "approval")


def test_opinion_comparisons_keep_option_and_scenario():
    rows = [r for r in from_analysis(analysis_result(), "UP")
            if r.measure == "delta_support" and r.series == "Completely Satisfied"]
    assert {(r.scenario, r.value) for r in rows} == {("pm_satisfaction", -2.5),
                                                       ("cm_satisfaction", 1.5)}


def test_uncovered_comparison_flagged_not_zeroed():
    r = pick(from_analysis(analysis_result(), "UP"), "delta_support", "SP")
    assert r.value is None and {"not_covered", "null_value"} <= r.flags


def test_gender_gap_rows():
    rows = from_analysis(analysis_result(), "UP")
    g = pick(rows, "gender_gap", "BJP")
    assert (g.value, g.unit, g.scenario) == (-3.25, "pp", "vote")
    assert pick(rows, "female_share", "BJP").value == 39.0
    m = pick(rows, "male_share", "BJP")
    assert m.value == 42.25 and m.unit == "pct"


def test_null_gender_base_flagged():
    rows = from_analysis(analysis_result(), "UP")
    for m in ("gender_gap", "female_share", "male_share"):
        r = pick(rows, m, "SP")
        assert r.value is None and "no_base" in r.flags


def test_subtotal_dims_marked():
    r = pick(from_analysis(analysis_result(), "UP"), "support_share", "BJP")
    assert r.dims == (("caste", "OBC", False), ("gender", None, True))


def test_scores_rows():
    rows = from_analysis(analysis_result(), "UP")
    n = pick(rows, "net_score", obs="obs2")
    assert (n.value, n.unit, n.series, n.scenario, n.base) == (25.0, "pp", "approval", "approval", 400.0)
    assert "no_base" not in n.flags
    assert pick(rows, "positive_share", obs="obs2").value == 55.0
    assert pick(rows, "negative_share", obs="obs2").value == 30.0


def test_zero_base_score_flagged():
    r = pick(from_analysis(analysis_result(), "UP"), "net_score", obs="obs4")
    assert r.value is None and "no_base" in r.flags


def test_null_score_is_none_flagged():
    res = analysis_result()
    res["scores"][0]["net_score"] = None
    r = pick(from_analysis(res, "UP"), "net_score", obs="obs2")
    assert r.value is None and r.flags


def test_benchmark_summaries_and_seat_delta():
    rows = from_benchmark(benchmark_result(), "UP", "ac")
    s = pick(rows, "seats_ac", "BJP", "ref")
    assert (s.value, s.unit, s.base, s.scenario) == (255, "seats", 403, None)
    v = pick(rows, "vote_share_bench", "BJP", "ref")
    assert (v.value, v.base) == (41.5, 9100.0)
    assert from_benchmark(benchmark_result(), "UP", "pc")[0].measure == "seats_pc"


def test_benchmark_grouping_sets_do_not_collide():
    rows = from_benchmark(benchmark_result(), "UP", "ac")
    seats = [r for r in rows if r.measure == "seats_ac" and r.obs_id == "tgt"]
    assert {(r.grouping_set_id, r.value, r.dims) for r in seats} == {
        ("g0", 180, ()), ("g1", 60, (("caste", "OBC", False),))}
    deltas = [r for r in rows if r.measure == "delta_seats_ac"]
    assert {(r.grouping_set_id, r.value, r.obs_id, r.dims) for r in deltas} == {
        ("g0", 7, "tgt", ()), ("g1", -3, "tgt", (("caste", "OBC", False),))}
    assert len({(r.measure, r.series, r.obs_id, r.grouping_set_id) for r in rows}) == len(rows)


def test_paired_benchmark_summaries_are_flagged_common_seats():
    from tests.fixtures.engine_results import benchmark_result

    paired = from_benchmark(benchmark_result(), "UP", "ac")
    summaries = [r for r in paired if r.measure == "seats_ac"]
    assert summaries and all("common_seats" in r.flags for r in summaries)
    single = benchmark_result()
    single["contract"]["reference"] = None
    single["comparisons"] = []
    assert all("common_seats" not in r.flags for r in from_benchmark(single, "UP", "ac"))
