"""Compile a CardConfig plus context into one engine job (spec section 6.2).

No engine arithmetic happens here: the card says which comparisons to ask for, the
engine computes them. Fixed numerical policy comes from the admin preset.
"""
from __future__ import annotations

from dataclasses import dataclass

from matbodh_dashboard.capability import resolve_anchor, template_blockers
from matbodh_dashboard.cards.config import (
    BENCHMARK_FAMILIES,
    RANKING_FAMILIES,
    RELATIONSHIP_FAMILIES,
    SEAT_DIMENSIONS,
    CardConfig,
    comparison_kind,
    scenario_kind,
)
from matbodh_dashboard.cards.families import get_family
from matbodh_dashboard.cohorts.restrict import cohort_blockers, respondent_filter
from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.compiler.coverage import choose_coverage
from matbodh_dashboard.compiler.plan import EngineJob, RunPlan, field_available
from matbodh_dashboard.compiler.requests import build_request, comparison, view_config
from matbodh_dashboard.compiler.rounds import ResolvedRound, resolve_rounds
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import MethodPreset

GRID = "grid"
MAX_TREND_ROUNDS = 4


@dataclass
class _Selection:
    used: list[ResolvedRound]
    target: ResolvedRound | None = None
    reference: ResolvedRound | None = None


def _names(rounds) -> str:
    return ", ".join(r.identity.base_name for r in rounds)


def _by_base_name(rounds: list[ResolvedRound], name: str) -> ResolvedRound | None:
    return next((r for r in rounds if r.identity.base_name == name), None)


def _needed_fields(config: CardConfig, gender_field: str | None) -> list[str]:
    fields = [d for cut in config.cuts for d in cut] + [f.field for f in config.filters]
    if gender_field:
        fields.append(gender_field)
    return list(dict.fromkeys(fields))


def _endpoint_round(ref: str, rounds, anchor: str, ctx: StateContext):
    if ref == "anchor":
        name = anchor
    elif ref == "compare":
        if ctx.compare_round is None:
            return None, "Choose a comparison round: this card compares against it"
        name = ctx.compare_round
    else:
        name = ref
    found = _by_base_name(rounds, name)
    if found is None:
        return None, f"Round {name!r} is not among the selected rounds"
    return found, None


def _select(config: CardConfig, ctx: StateContext, rounds, anchor: str,
            unavailable: list, not_asked: list) -> _Selection | None:
    mode = config.comparison.mode
    if mode == "standalone":
        anchor_round = _by_base_name(rounds, anchor)
        for scenario in config.scenarios:
            if scenario not in anchor_round.dataset.scenarios:
                unavailable.append((GRID, f"Scenario {scenario!r} was not asked in {anchor}"))
        return _Selection([anchor_round])

    if mode == "trend":
        if len(rounds) > MAX_TREND_ROUNDS:
            unavailable.append((GRID, f"Trend shows at most {MAX_TREND_ROUNDS} rounds; "
                                      f"{len(rounds)} are selected"))
            return None
        scenario = config.scenarios[0]
        asked = [r for r in rounds if scenario in r.dataset.scenarios]
        dropped = [r for r in rounds if r not in asked]
        if dropped:
            not_asked.append((GRID, tuple(r.identity.base_name for r in dropped)))
        if len(asked) < 2:
            unavailable.append((GRID, f"Trend needs {scenario!r} in at least 2 rounds; "
                                      f"{len(asked)} of the selected rounds asked it"))
        return _Selection(asked)

    target_ref, reference_ref = config.comparison.target, config.comparison.reference
    target, target_error = _endpoint_round(target_ref.round, rounds, anchor, ctx)
    reference, reference_error = _endpoint_round(reference_ref.round, rounds, anchor, ctx)
    for error in (target_error, reference_error):
        if error:
            unavailable.append((GRID, error))
    if target is None or reference is None:
        return None
    for endpoint, round_ in ((target_ref, target), (reference_ref, reference)):
        if endpoint.scenario not in round_.dataset.scenarios:
            unavailable.append((GRID, f"Scenario {endpoint.scenario!r} was not asked in "
                                      f"{round_.identity.base_name}"))
    used = [r for r in rounds if r.obs_id in {target.obs_id, reference.obs_id}]
    return _Selection(used, target, reference)


def _comparisons(config: CardConfig, selection: _Selection) -> list[dict]:
    if config.comparison.mode != "compare":
        return []
    target, reference = config.comparison.target, config.comparison.reference
    kind = comparison_kind(scenario_kind(target.scenario), scenario_kind(reference.scenario))
    measures = [None] if kind == "shakti" else config.comparison.delta_measures
    return [
        comparison(selection.target, selection.reference, target.scenario,
                   *(() if m is None else (m,)), kind=kind,
                   reference_scenario=reference.scenario)
        for m in measures
    ]


def compile_card(config: CardConfig, ctx: StateContext, catalogue: Catalogue,
                 preset: MethodPreset, *, reference=None, parties=None, elections=None,
                 cohort=None) -> RunPlan:
    if config.family in RELATIONSHIP_FAMILIES:
        # Lazy: the relationship compiler reuses this module's round helpers.
        from matbodh_dashboard.cards.relationship.compile import compile_relationship_card

        return compile_relationship_card(config, ctx, catalogue, preset, parties=parties, cohort=cohort)
    if config.family in BENCHMARK_FAMILIES:
        # Lazy: the benchmark compiler reuses this module's round helpers.
        from matbodh_dashboard.cards.benchmark.compile import compile_benchmark_card

        return compile_benchmark_card(config, ctx, catalogue, preset, reference=reference,
                                      parties=parties, elections=elections, cohort=cohort)
    if config.family in RANKING_FAMILIES:
        # Lazy: the ranking compiler reuses this module's round selection.
        from matbodh_dashboard.cards.ranking.compile import compile_ranking_card

        return compile_ranking_card(config, ctx, catalogue, preset, cohort=cohort)
    spec = get_family(config.family)
    rounds = resolve_rounds(ctx, catalogue)
    anchor = resolve_anchor(ctx, catalogue)
    unavailable: list[tuple[str, str]] = []
    not_asked: list[tuple[str, tuple[str, ...]]] = []

    def plan(jobs=()) -> RunPlan:
        return RunPlan(card_id=config.id, state=ctx.state, rounds=tuple(rounds), anchor=anchor,
                       compare=ctx.compare_round, jobs=tuple(jobs),
                       unavailable=tuple(unavailable), not_asked=tuple(not_asked))

    fields = _needed_fields(config, preset.gender.field if spec.gender_differential else None)
    blockers = template_blockers(config.requires.min_level, fields, ctx.level)
    if blockers:
        unavailable.extend((GRID, reason) for reason in blockers)
        return plan()

    selection = _select(config, ctx, rounds, anchor, unavailable, not_asked)
    if selection is None or unavailable:
        return plan()
    for field in fields:
        missing = [r for r in selection.used if not field_available(r.dataset, field)]
        if missing:
            unavailable.append((GRID, f"Field {field!r} needs to exist in every included "
                                      f"round; missing in: {_names(missing)}"))
    if unavailable:
        return plan()

    if cohort is not None:
        blockers = cohort_blockers(cohort, selection.used[0].dataset.level, len(selection.used))
        if blockers:
            unavailable.extend((GRID, reason) for reason in blockers)
            return plan()
    mode = config.comparison.mode
    geographic = any(f in SEAT_DIMENSIONS for f in fields)
    coverage = (choose_coverage(selection.used, uses_seat_ids=False, geographic=geographic,
                                version_mode=ctx.version_mode)
                if mode == "compare" else "independent")
    if cohort is not None and len(selection.used) > 1:
        coverage = "common"  # rounds must be read on the same cohort seats
    reference_observation = (selection.reference.obs_id
                             if coverage == "common" and selection.reference else None)
    anchor_round = _by_base_name(rounds, anchor)
    caste_reference = (selection.reference if selection.reference is not None
                       else anchor_round if anchor_round in selection.used
                       else selection.used[-1])
    request = build_request(
        state=ctx.state,
        rounds=selection.used,
        scenarios=list(config.scenarios),
        grouping_sets=config.cuts,
        preset=preset,
        comparisons=_comparisons(config, selection),
        gender=spec.gender_differential,
        coverage_mode=coverage,
        filters=[{"field": f.field, "operator": f.operator, "values": list(f.values)}
                 for f in config.filters] + ([respondent_filter(cohort)] if cohort is not None else []),
        caste_clubbing=({"threshold_pct": preset.caste_threshold_pct,
                         "reference_observation": caste_reference.obs_id}
                        if config.caste_clubbing else None),
        reference_observation=reference_observation,
    )
    return plan([EngineJob(GRID, "analysis", GRID, view_config(request, preset))])
