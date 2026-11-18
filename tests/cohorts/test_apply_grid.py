from datetime import datetime, timezone

import pytest

from matbodh_dashboard.cards.compile import compile_card
from matbodh_dashboard.cohorts.models import CohortRef
from matbodh_dashboard.compiler.fingerprint import fingerprint
from tests.cards import test_compile as grid
from tests.cards import test_relationship_compile as rel

NOW = datetime(2026, 11, 18, tzinfo=timezone.utc)


def cohort(level="ac", ids=(12, 3)):
    return CohortRef(seat_level=level, seat_ids=list(ids), label="L", created_at=NOW)


COMPARE = {"mode": "compare", "target": {"scenario": grid.VS},
           "reference": {"round": "compare", "scenario": grid.VS}}


def grid_plan(config, c, level="ac", rounds=3, ctx=None):
    return compile_card(config, ctx or grid._ctx(level=level), grid._catalogue(level, rounds), grid.PRESET, cohort=c)


def test_cohort_adds_filter_and_common_coverage_for_a_two_round_card():
    config = grid._config(comparison=COMPARE, filters=[{"field": "category", "operator": "in", "values": ["GEN"]}])
    (job,) = grid_plan(config, cohort()).jobs
    request = job.config["request"]
    assert request["filters"] == [{"field": "category", "operator": "in", "values": ["GEN"]},
                                  {"field": "ac_num", "operator": "in", "values": ["3", "12"]}]
    assert request["coverage_mode"] == "common" and request["reference_observation"] is not None


def test_a_single_round_card_gets_the_filter_but_stays_independent():
    (job,) = grid_plan(grid._config(), cohort()).jobs
    request = job.config["request"]
    assert request["filters"][-1]["field"] == "ac_num"
    assert request["coverage_mode"] == "independent"


def test_no_cohort_changes_nothing():
    (with_none,) = grid_plan(grid._config(comparison=COMPARE), None).jobs
    assert with_none.config["request"]["filters"] == []


def test_cohort_changes_the_fingerprint():
    def fp(c):
        (job,) = grid_plan(grid._config(comparison=COMPARE), c).jobs
        return fingerprint(job.config, metadata_revision=1, engine_version="x", alliance_epoch=0)

    assert len({fp(None), fp(cohort()), fp(cohort(ids=(12, 4)))}) == 3
    assert fp(cohort(ids=(3, 12))) == fp(cohort(ids=(12, 3, 3)))


def test_unavailable_reason_when_the_cohort_cannot_apply():
    plan = grid_plan(grid._config(comparison=COMPARE), cohort("pc"))
    assert plan.jobs == () and any("membership" in r for _, r in plan.unavailable)
    plan = grid_plan(grid._config(), cohort("ac"), level="pc", ctx=grid._ctx(level="pc"))
    assert plan.jobs == () and plan.unavailable


def test_relationship_cohort_filter_and_common_coverage():
    plan = compile_card(rel._card(), rel._ctx(), rel._catalogue(), rel.PRESET, parties=rel.FakeParties(),
                        cohort=cohort())
    (job,) = plan.jobs
    request = job.config["request"]
    assert request["filters"] == [{"field": "ac_num", "operator": "in", "values": ["3", "12"]}]
    assert request["coverage_mode"] == "common"


def test_relationship_pc_cohort_over_two_ac_rounds_is_unavailable_with_a_reason():
    plan = compile_card(rel._card(), rel._ctx(), rel._catalogue(), rel.PRESET, parties=rel.FakeParties(),
                        cohort=cohort("pc"))
    assert plan.jobs == () and any("membership" in r for _, r in plan.unavailable)
