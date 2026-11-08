"""Turn one dashboard card plus context into engine jobs."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Literal

from matbodh_dashboard.capability import capabilities, resolve_anchor
from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.compiler.coverage import choose_coverage
from matbodh_dashboard.compiler.requests import build_request, comparison, view_config
from matbodh_dashboard.compiler.rounds import ResolvedRound, resolve_rounds
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import MethodPreset
from matbodh_dashboard.templates import CardTemplate

VOTE_SCENARIO = "vs_voting_intention"
SEATS_UNAVAILABLE = "Seat views need an AC or PC level survey"
# The ungrouped twin of the vote job. The vote job applies other_grouping, so
# the engine folds every party outside the keep list into Other; benchmark
# summaries cover only listed contenders. Contenders, and the vote share of a
# seat winner outside the keep list, therefore come from this job.
PARTIES_JOB = "parties"


@dataclass(frozen=True)
class EngineJob:
    key: str
    kind: Literal["analysis", "benchmark"]
    part: str  # vote | parties | seats_ac | seats_pc | opinion | zone
    config: dict
    contenders_from: str | None = None


@dataclass(frozen=True)
class RunPlan:
    card_id: str
    state: str
    rounds: tuple[ResolvedRound, ...]
    anchor: str
    compare: str | None
    jobs: tuple[EngineJob, ...]
    unavailable: tuple[tuple[str, str], ...]


def _by_base_name(rounds: Sequence[ResolvedRound], base_name: str) -> ResolvedRound:
    for r in rounds:
        if r.identity.base_name == base_name:
            return r
    raise ValueError(f"round {base_name!r} is not among the resolved rounds")


def _endpoint(round_: ResolvedRound) -> dict:
    return {
        "source": "survey",
        "id": round_.obs_id,
        "observation": round_.obs_id,
        "scenario": VOTE_SCENARIO,
    }


def _benchmark_job(
    part: str,
    level: str,
    target: ResolvedRound,
    reference: ResolvedRound | None,
    ctx: StateContext,
    preset: MethodPreset,
) -> EngineJob:
    used = [target] if reference is None else [reference, target]
    used.sort(key=lambda r: r.obs_id)
    key = f"{part}_{target.obs_id}" + (f"_{reference.obs_id}" if reference else "")
    request = build_request(
        state=ctx.state,
        rounds=used,
        scenarios=[VOTE_SCENARIO],
        grouping_sets=[[]],
        preset=preset,
        other_grouping=False,
    )
    benchmark = {
        "id": key,
        "seat_level": level,
        "target": _endpoint(target),
        "reference": _endpoint(reference) if reference else None,
        "contenders": [],
        "focal_party": None,
        "grouping_sets": [[]],
        "filters": [],
        "seat_ids": [],
    }
    return EngineJob(
        key=key,
        kind="benchmark",
        part=part,
        config=view_config(request, preset, benchmark=benchmark),
        contenders_from=PARTIES_JOB,
    )


def plan_card(
    template: CardTemplate,
    ctx: StateContext,
    catalogue: Catalogue,
    preset: MethodPreset,
) -> RunPlan:
    rounds = resolve_rounds(ctx, catalogue)
    anchor_name = resolve_anchor(ctx, catalogue)
    anchor = _by_base_name(rounds, anchor_name)
    compare = _by_base_name(rounds, ctx.compare_round) if ctx.compare_round else None
    scenarios = list(template.questions)
    measure = "net_score" if template.operation == "opinion" else "support_share"
    comparisons = (
        [comparison(anchor, compare, s, measure) for s in scenarios] if compare else []
    )
    jobs: list[EngineJob] = []
    unavailable: list[tuple[str, str]] = []

    if template.operation == "scoreboard":
        coverage = choose_coverage(
            rounds, uses_seat_ids=False, geographic=False, version_mode=ctx.version_mode
        )
        request = build_request(
            state=ctx.state, rounds=rounds, scenarios=scenarios,
            grouping_sets=[[]], preset=preset, comparisons=comparisons,
            gender=True, coverage_mode=coverage,
        )
        jobs.append(EngineJob("vote", "analysis", "vote", view_config(request, preset)))
        allowed = capabilities(ctx.level).seat_levels
        if allowed:
            ungrouped = build_request(
                state=ctx.state, rounds=rounds, scenarios=scenarios,
                grouping_sets=[[]], preset=preset, coverage_mode=coverage,
                other_grouping=False,
            )
            jobs.append(EngineJob(PARTIES_JOB, "analysis", PARTIES_JOB,
                                  view_config(ungrouped, preset)))
        others = [r for r in rounds if r is not anchor and r is not compare]
        for level in ("ac", "pc"):
            part = f"seats_{level}"
            if level not in allowed:
                if not allowed:  # zone/state surveys have no seat views at all
                    unavailable.append((part, SEATS_UNAVAILABLE))
                continue
            jobs.append(_benchmark_job(part, level, anchor, compare, ctx, preset))
            for other in others:
                jobs.append(_benchmark_job(part, level, other, None, ctx, preset))
    elif template.operation == "opinion":
        coverage = choose_coverage(
            rounds, uses_seat_ids=False, geographic=False, version_mode=ctx.version_mode
        )
        request = build_request(
            state=ctx.state, rounds=rounds, scenarios=scenarios,
            grouping_sets=[[]], preset=preset, comparisons=comparisons,
            coverage_mode=coverage,
        )
        jobs.append(EngineJob("opinion", "analysis", "opinion", view_config(request, preset)))
    else:  # distribution (by zone)
        coverage = choose_coverage(
            rounds, uses_seat_ids=False, geographic=True, version_mode=ctx.version_mode
        )
        request = build_request(
            state=ctx.state, rounds=rounds, scenarios=scenarios,
            grouping_sets=[[], ["party_zone"]], preset=preset,
            comparisons=comparisons, coverage_mode=coverage,
        )
        jobs.append(EngineJob("zone", "analysis", "zone", view_config(request, preset)))

    return RunPlan(
        card_id=template.id,
        state=ctx.state,
        rounds=tuple(rounds),
        anchor=anchor_name,
        compare=ctx.compare_round,
        jobs=tuple(jobs),
        unavailable=tuple(unavailable),
    )


def bind_contenders(
    job: EngineJob, parties: Sequence[str], preset: MethodPreset
) -> EngineJob:
    """Fill a benchmark job's contenders from the ungrouped parties job's list,
    minus competition-excluded identities and the Other label."""
    if job.kind != "benchmark":
        raise ValueError("only benchmark jobs take contenders")
    excluded = set(preset.competition_excluded) | {preset.other_label}
    contenders = sorted(p for p in set(parties) if p not in excluded)
    benchmark = {**job.config["benchmark"], "contenders": contenders}
    return replace(job, config={**job.config, "benchmark": benchmark})
