"""Every config plan_card emits is accepted by the engine's own validation.

No database: requests go through LeaningEngine.resolve and benchmarks through
matbodh_views.benchmark.validate_benchmark_view, with observations expanded
the way the engine's MetadataSession expands them (tests/compiler/engine_stub).
The catalogue fixture has a round (R1) that did not ask cm_satisfaction.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.compiler.plan import bind_contenders, plan_card
from matbodh_dashboard.compiler.requests import build_request
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import load_preset
from matbodh_dashboard.templates import load_templates
from tests.compiler.engine_stub import (
    resolve_with_engine, validate_benchmark_with_engine,
)
from tests.fixtures.catalogue_rows import dataset_row, level_row, make_query

ROOT = Path(__file__).resolve().parents[2]
PRESET = load_preset(ROOT / "config/presets/uttar-pradesh.standard-v1.yaml")
TEMPLATES = load_templates(ROOT / "config/templates/pulse.yaml")
STATE = "Uttar Pradesh"
R1, R2 = "2027 VS CAPI R1", "2027 VS CAPI R2"
# Labels the ungrouped parties job could return (real labels include small parties).
PARTIES = ["NDA", "SP+", "BSP", "JDL", "AIMIM", "Others", "NOTA"]


def _plan(card, catalogue=None, **ctx):
    args = dict(state=STATE, level="ac", rounds=[R1, R2], compare_round=R1)
    args.update(ctx)
    return plan_card(TEMPLATES[card], StateContext(**args),
                     catalogue or load_catalogue(make_query()), PRESET)


def _check(plan):
    rounds = list(plan.rounds)
    checked = 0
    for job in plan.jobs:
        if job.kind == "benchmark":
            validate_benchmark_with_engine(bind_contenders(job, PARTIES, PRESET).config, rounds)
        else:
            resolve_with_engine(job.config["request"], rounds)
        checked += 1
    return checked


def test_scoreboard_vote_parties_and_benchmarks_accepted():
    plan = _plan("pulse.party_scoreboard")
    assert [j.part for j in plan.jobs] == ["vote", "parties", "seats_ac", "seats_pc"]
    assert _check(plan) == 4


def test_scoreboard_three_rounds_single_benchmarks_accepted():
    rows = [dataset_row(R1, round_number=1), dataset_row(R2, round_number=2),
            dataset_row("2027 VS CAPI R3", round_number=3)]
    levels = [level_row(r["dataset_id"], range(1, 404)) for r in rows]
    plan = _plan("pulse.party_scoreboard", rounds=[R1, R2, "2027 VS CAPI R3"],
                 catalogue=load_catalogue(make_query(rows, levels)))
    assert _check(plan) == 6


def test_matched_mode_benchmarks_with_seat_ids_accepted():
    plan = _plan("pulse.party_scoreboard", version_mode="matched")
    ac = [j for j in plan.jobs if j.part == "seats_ac"]
    assert ac and ac[0].config["benchmark"]["seat_ids"]
    assert _check(plan) == 3  # vote, parties, seats_ac; seats_pc is unavailable


def test_pc_level_benchmark_accepted():
    rows = [dataset_row(n, round_number=i, level="pc") for i, n in enumerate([R1, R2], 1)]
    levels = [level_row(n, range(1, 81)) for n in (R1, R2)]
    plan = _plan("pulse.party_scoreboard", level="pc", version_mode="matched",
                 catalogue=load_catalogue(make_query(rows, levels)))
    assert [j.part for j in plan.jobs] == ["vote", "parties", "seats_pc"]
    assert _check(plan) == 3


def test_benchmarks_carry_the_preset_competition_exclusions():
    plan = _plan("pulse.party_scoreboard")
    for job in plan.jobs:
        if job.kind == "benchmark":
            assert job.config["benchmark"]["competition_excluded"] == ["NOTA"]
    bad = bind_contenders(plan.jobs[2], PARTIES, PRESET).config
    bad["benchmark"]["competition_excluded"] = ["NOTA", "NOTA"]
    with pytest.raises(ValueError, match="competition_excluded"):
        validate_benchmark_with_engine(bad, list(plan.rounds))


def test_benchmark_without_contenders_is_rejected_by_the_engine():
    plan = _plan("pulse.party_scoreboard")
    with pytest.raises(ValueError, match="contenders"):
        validate_benchmark_with_engine(plan.jobs[2].config, list(plan.rounds))


def test_opinion_split_jobs_accepted():
    plan = _plan("pulse.leaders")
    assert [j.key for j in plan.jobs] == ["opinion_1", "opinion_2"]
    assert _check(plan) == 2


def test_unsplit_opinion_request_is_what_the_engine_rejects():
    """Why C2 splits jobs: one request over R1 and R2 asking cm_satisfaction."""
    plan = _plan("pulse.leaders")
    request = build_request(state=STATE, rounds=list(plan.rounds),
                            scenarios=["pm_satisfaction", "cm_satisfaction"],
                            grouping_sets=[[]], preset=PRESET)
    with pytest.raises(ValueError, match="Unverified scenario availability in o1"):
        resolve_with_engine(request, list(plan.rounds))


def test_change_appetite_accepted():
    plan = _plan("pulse.change_appetite")
    assert _check(plan) == 1


def test_by_zone_common_coverage_accepted():
    plan = _plan("pulse.by_zone")
    (zone,) = plan.jobs
    assert zone.config["request"]["coverage_mode"] == "common"
    assert _check(plan) == 1


def test_by_zone_party_zone_is_a_master_attribute_for_the_engine():
    # No round lists party_zone: the engine still accepts the cut, as its
    # metadata session adds master attributes to every observation.
    rows = [dataset_row(n, round_number=i, available_fields=["gender", "age"])
            for i, n in enumerate([R1, R2], 1)]
    levels = [level_row(n, range(1, 404)) for n in (R1, R2)]
    plan = _plan("pulse.by_zone", catalogue=load_catalogue(make_query(rows, levels)))
    assert [j.part for j in plan.jobs] == ["zone"] and plan.unavailable == ()
    assert _check(plan) == 1


def test_scoreboard_without_gender_field_accepted():
    rows = [dataset_row(R1, round_number=1, available_fields=["age", "ac_num", "pc_num"]),
            dataset_row(R2, round_number=2)]
    levels = [level_row(n, range(1, 404)) for n in (R1, R2)]
    plan = _plan("pulse.party_scoreboard", catalogue=load_catalogue(make_query(rows, levels)))
    assert plan.jobs[0].config["request"]["gender_differential"] is None
    assert _check(plan) == 4
