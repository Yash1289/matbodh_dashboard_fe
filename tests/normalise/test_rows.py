from matbodh_dashboard.normalise.rows import NormalRow, from_analysis, from_benchmark
from tests.fixtures.engine_results import analysis_result, benchmark_result, dims


def pick(rows, measure, series=None, obs=None):
    out = [r for r in rows if r.measure == measure
           and (series is None or r.series == series) and (obs is None or r.obs_id == obs)]
    assert len(out) == 1, out
    return out[0]


def test_support_rows_keep_base():
    rows = from_analysis(analysis_result(), "Uttar Pradesh")
    r = pick(rows, "support_share", "BJP")
    assert (r.state, r.obs_id, r.value, r.unit, r.base) == ("Uttar Pradesh", "obs1", 41.5, "pct", 812.25)
    assert r.flags == frozenset()
    assert not [x for x in rows if x.obs_id == "obs_dead"]


def test_comparison_rows_use_engine_delta():
    rows = from_analysis(analysis_result(), "UP")
    r = pick(rows, "delta_support", "BJP")
    assert r.value == 5.0 and r.value != 41.5 - 33.0
    assert r.obs_id == "obs1" and r.unit == "pp"
    n = pick(rows, "delta_net_score")
    assert (n.series, n.obs_id, n.value) == ("approval", "obs2", -2.5)


def test_gender_gap_rows():
    rows = from_analysis(analysis_result(), "UP")
    assert pick(rows, "gender_gap", "BJP").value == -3.25
    assert pick(rows, "gender_gap", "BJP").unit == "pp"
    assert pick(rows, "female_share", "BJP").value == 39.0
    assert pick(rows, "male_share", "BJP").value == 42.25
    assert pick(rows, "male_share", "BJP").unit == "pct"


def test_null_gender_base_flagged():
    rows = from_analysis(analysis_result(), "UP")
    for m in ("gender_gap", "female_share", "male_share"):
        r = pick(rows, m, "SP")
        assert r.value is None and "no_base" in r.flags


def test_subtotal_dims_marked():
    rows = from_analysis(analysis_result(), "UP")
    r = pick(rows, "support_share", "BJP")
    assert r.dims == (("caste", "OBC", False), ("gender", None, True))


def test_scores_rows():
    rows = from_analysis(analysis_result(), "UP")
    assert pick(rows, "net_score").value == 25.0 and pick(rows, "net_score").unit == "pp"
    assert pick(rows, "net_score").series == "approval" and pick(rows, "net_score").base == 400.0
    assert pick(rows, "positive_share").value == 55.0
    assert pick(rows, "negative_share").value == 30.0


def test_null_score_is_none_flagged():
    res = analysis_result()
    res["scores"][0]["net_score"] = None
    r = pick(from_analysis(res, "UP"), "net_score")
    assert r.value is None and r.flags


def test_benchmark_summaries_and_seat_delta():
    rows = from_benchmark(benchmark_result(), "UP", "ac")
    s = pick(rows, "seats_ac", "BJP", "tgt")
    assert (s.value, s.unit, s.base) == (180, "seats", 403)
    assert pick(rows, "seats_ac", "BJP", "ref").value == 255
    assert pick(rows, "vote_share_bench", "BJP", "tgt").value == 41.0
    d = pick(rows, "delta_seats_ac")
    assert d.value == 7 and d.obs_id == "tgt" and d.unit == "seats"
    assert isinstance(d, NormalRow)
    assert from_benchmark(benchmark_result(), "UP", "pc")[0].measure.endswith("_pc")
