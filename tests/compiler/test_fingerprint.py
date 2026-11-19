from matbodh_dashboard.compiler.fingerprint import fingerprint

CFG = {"a": 1, "b": {"x": [1, 2], "y": None}}
KW = dict(metadata_revision=3, engine_version="1.0", alliance_epoch=2)


def test_fingerprint_stable_under_key_order():
    reordered = {"b": {"y": None, "x": [1, 2]}, "a": 1}
    assert fingerprint(CFG, **KW) == fingerprint(reordered, **KW)
    assert len(fingerprint(CFG, **KW)) == 64


def test_fingerprint_changes_with_revision_engine_and_epoch():
    base = fingerprint(CFG, **KW)
    assert fingerprint(CFG, **{**KW, "metadata_revision": 4}) != base
    assert fingerprint(CFG, **{**KW, "engine_version": "1.1"}) != base
    assert fingerprint(CFG, **{**KW, "alliance_epoch": 3}) != base
    assert fingerprint({**CFG, "a": 2}, **KW) != base


# -- a card's id and title never reach the engine config (spec 8.1) ------------------------------


def _jobs(plan):
    assert plan.unavailable == (), plan.unavailable
    return [job.config for job in plan.jobs]


def test_fingerprint_ignores_card_id_and_title():
    from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
    from tests.cards import test_benchmark_compile as bench
    from tests.cards import test_cohort_compile as cohort
    from tests.cards import test_compile as grid
    from tests.cards import test_ranking_compile as rank
    from tests.cards import test_relationship_compile as relationship

    families = {
        "distribution": lambda **o: grid._compile(grid._config(**o)),
        "seat_ranking": lambda **o: rank._compile(rank._seat(**o)),
        "seat_ranking_trend": lambda **o: rank._compile(rank._seat(comparison={"mode": "trend"}, **o)),
        "demographic_ranking": lambda **o: rank._compile(rank._demographic(**o)),
        "seat_benchmark": lambda **o: bench._compile(bench._card(**o), reference=BenchmarkReference(kind="compare")),
        "relationship": lambda **o: relationship._compile(relationship._card(**o)),
        "cohort_preview_of_a_seat_ranking": lambda **o: cohort.rank_selection(rank._seat(**o)),
    }
    for name, compile_ in families.items():
        first = _jobs(compile_(id="one", title="First"))
        second = _jobs(compile_(id="two", title="Second"))
        assert first == second, name
        assert [fingerprint(c, **KW) for c in first] == [fingerprint(c, **KW) for c in second], name
