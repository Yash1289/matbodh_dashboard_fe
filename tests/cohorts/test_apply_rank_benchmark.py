from datetime import datetime, timezone

import pytest

from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
from matbodh_dashboard.cards.compile import compile_card
from matbodh_dashboard.cohorts.models import CohortRef
from matbodh_dashboard.compiler.fingerprint import fingerprint
from matbodh_dashboard.compiler.rounds import resolve_rounds
from tests.cards import test_benchmark_compile as bench
from tests.cards import test_ranking_compile as rank
from tests.cards.test_benchmark_engine_loader import _engine_ready
from tests.compiler.engine_stub import validate_benchmark_with_engine

NOW = datetime(2026, 11, 18, tzinfo=timezone.utc)


def cohort(level="ac", ids=(12, 3)):
    return CohortRef(seat_level=level, seat_ids=list(ids), label="L", created_at=NOW)


def rank_plan(config, c, level="ac"):
    return compile_card(config, rank._ctx(level=level), rank._catalogue(level), rank.PRESET, cohort=c)


def bench_plan(c, level="ac", reference=None):
    return compile_card(bench._card(), bench._ctx(level=level), bench._catalogue(level), bench.PRESET,
                        reference=reference, parties=bench.FakeParties(), elections=bench.ELECTIONS, cohort=c)


def test_seat_ranking_under_a_cohort_ranks_only_the_cohort_seats():
    (job,) = rank_plan(rank._seat(), cohort()).jobs
    assert job.config["ranking"]["seat_ids"] == [3, 12]
    assert job.config["ranking"]["display_seat_ids"] == []


def test_trend_ranking_restricts_every_round_job():
    config = rank._seat(comparison={"mode": "trend"})
    plan = rank_plan(config, cohort())
    assert len(plan.jobs) > 1 and all(j.config["ranking"]["seat_ids"] == [3, 12] for j in plan.jobs)


def test_pc_seat_ranking_from_ac_rounds_keeps_its_membership_and_takes_the_pc_cohort():
    (job,) = rank_plan(rank._seat(rank={"level": "pc"}), cohort("pc", (4, 9))).jobs
    assert job.config["ranking"]["seat_ids"] == [4, 9]
    assert job.config["ranking"]["membership_snapshot"] == "ac_pc"


def test_demographic_ranking_under_a_cohort_adds_a_respondent_filter():
    config = rank._demographic(filters=[{"field": "gender", "values": ["Female"]}])
    (job,) = rank_plan(config, cohort()).jobs
    assert job.config["request"]["filters"] == [
        {"field": "gender", "operator": "in", "values": ["Female"]},
        {"field": "ac_num", "operator": "in", "values": ["3", "12"]}]
    assert "seat_ids" not in job.config["ranking"]


def test_ranking_level_mismatch_is_unavailable_with_a_reason():
    plan = rank_plan(rank._seat(), cohort("pc"))
    assert plan.jobs == ()
    assert any("ranks AC" in r and "PC" in r for _, r in plan.unavailable)


def test_benchmark_under_a_cohort_sets_seat_ids_and_keeps_the_constant_id():
    (job,) = bench_plan(cohort()).jobs
    assert job.config["benchmark"]["seat_ids"] == [3, 12] and job.config["benchmark"]["id"] == "benchmark"


def test_benchmark_level_mismatch_is_unavailable_with_a_reason():
    plan = bench_plan(cohort("pc"))
    assert plan.jobs == () and any("PC" in r for _, r in plan.unavailable)


def test_cohort_ranking_fingerprint_differs_from_none():
    def fp(c):
        (job,) = rank_plan(rank._seat(), c).jobs
        return fingerprint(job.config, metadata_revision=1, engine_version="x", alliance_epoch=0)

    assert len({fp(None), fp(cohort()), fp(cohort(ids=(12, 4)))}) == 3


def test_a_cohort_restricted_benchmark_loads_and_validates_in_the_engine():
    pytest.importorskip("matbodh_views.benchmark", reason="engine package not importable")
    plan = bench_plan(cohort(), reference=BenchmarkReference(kind="compare"))
    assert plan.unavailable == () and plan.jobs[0].config["benchmark"]["seat_ids"] == [3, 12]
    rounds = resolve_rounds(bench._ctx(), bench._catalogue())
    validate_benchmark_with_engine(_engine_ready(plan.jobs[0].config), rounds)


def test_a_cohort_restricted_seat_ranking_loads_in_the_engines_strict_loader():
    configuration = pytest.importorskip("matbodh_dash.configuration", reason="engine package not importable")
    (job,) = rank_plan(rank._seat(), cohort()).jobs
    assert configuration.ranking_from_dict(job.config["ranking"]).seat_ids == (3, 12)
