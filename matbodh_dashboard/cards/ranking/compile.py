"""Compile a ranking CardConfig into engine jobs (spec section 5.1).

Standalone and compare cards are one job; a trend is one job per asked round, because
one engine ranking has exactly one target. No rank arithmetic happens here.
"""
from __future__ import annotations

from matbodh_dashboard.capability import (
    anchor_level, capabilities, resolve_anchor, round_level_blockers, template_blockers,
)
from matbodh_dashboard.cards.compile import GRID, _select, _Selection, compare_in, read_levels, windowed
from matbodh_dashboard.cards.config import SEAT_DIMENSIONS, CardConfig, comparison_kind, scenario_kind
from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.compiler.coverage import choose_coverage
from matbodh_dashboard.compiler.plan import EngineJob, RunPlan, field_available
from matbodh_dashboard.compiler.requests import build_request, comparison, view_config
from matbodh_dashboard.compiler.rounds import ResolvedRound, resolve_rounds
from matbodh_dashboard.cohorts.models import CohortRef
from matbodh_dashboard.cohorts.restrict import (
    cohort_blockers, level_mismatch, respondent_filter, seat_restriction,
)
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import MethodPreset


def _filters(specs) -> list[dict]:
    return [{"field": f.field, "operator": f.operator, "values": list(f.values)} for f in specs]


def _comparison(config: CardConfig, selection: _Selection) -> dict:
    target, reference = config.comparison.target, config.comparison.reference
    kind = comparison_kind(scenario_kind(target.scenario), scenario_kind(reference.scenario))
    measure = () if kind == "shakti" else (config.rank.metric,)
    return comparison(selection.target, selection.reference, target.scenario, *measure,
                      kind=kind, reference_scenario=reference.scenario)


def _ranking(config: CardConfig, round_: ResolvedRound | None, scenario: str | None,
             comparison_id: str | None, survey_level: str, cohort: CohortRef | None = None) -> dict:
    rank = config.rank
    target = [round_.obs_id, scenario] if comparison_id is None else None
    # Not the card id: it would put client ids into fingerprints (spec 8.1).
    shared = {"id": "ranking", "target": target, "comparison_id": comparison_id,
              "measure": rank.metric, "party_id": rank.party_id,
              "partition_by": list(rank.partition_by), "top_k": rank.top_k}
    if config.family == "demographic_ranking":
        return {**shared, "level": rank.level}
    return {
        **shared, "seat_level": rank.level, "universe_snapshot": f"{rank.level}_roster",
        "seat_ids": [], "filters": _filters(rank.filters), "display_seat_ids": [],
        # A PC ranking from an AC-designed survey needs the AC-to-PC membership.
        "membership_snapshot": "ac_pc" if rank.level == "pc" and survey_level == "ac" else None,
        **(seat_restriction(cohort) if cohort is not None else {}),
    }


def compile_ranking_card(config: CardConfig, ctx: StateContext, catalogue: Catalogue,
                         preset: MethodPreset, cohort: CohortRef | None = None) -> RunPlan:
    rank = config.rank
    anchor = resolve_anchor(ctx, catalogue)
    rounds, notes = windowed(config, resolve_rounds(ctx, catalogue), anchor)
    unavailable: list[tuple[str, str]] = []
    not_asked: list[tuple[str, tuple[str, ...]]] = []

    def plan(jobs=()) -> RunPlan:
        return RunPlan(card_id=config.id, state=ctx.state, rounds=tuple(rounds), anchor=anchor,
                       compare=compare_in(rounds, ctx.compare_round), jobs=tuple(jobs),
                       unavailable=tuple(unavailable), not_asked=tuple(not_asked), notes=notes)

    demographic = config.family == "demographic_ranking"
    fields = ([rank.level, *rank.partition_by, *(f.field for f in config.filters)]
              if demographic else [])
    level = anchor_level(ctx, catalogue)
    unavailable.extend((GRID, r) for r in [
        *template_blockers(config.requires.min_level, fields, level),
        *round_level_blockers(read_levels(config, ctx, rounds, anchor))])
    if not demographic and rank.level not in capabilities(level).seat_levels:
        unavailable.append((GRID, f"{rank.level.upper()}-level ranking is not available for "
                                  f"{level.upper()}-level surveys"))
    if rank.party_id is not None and rank.party_id not in preset.keep:
        # Parties outside `keep` fold into Other, so the engine would rank this one at zero everywhere.
        unavailable.append((GRID, f"Party {rank.party_id!r} is not a party this preset keeps "
                                  f"separate ({', '.join(preset.keep)})"))
    if unavailable:
        return plan()

    selection = _select(config, ctx, rounds, anchor, unavailable, not_asked)
    if selection is None or unavailable:
        return plan()
    for field in fields:
        missing = [r for r in selection.used if not field_available(r.dataset, field)]
        if missing:
            unavailable.append((GRID, f"Field {field!r} needs to exist in every included "
                                      f"round; missing in: "
                                      f"{', '.join(r.identity.base_name for r in missing)}"))
    if unavailable:
        return plan()

    if cohort is not None:
        blockers = (cohort_blockers(cohort, selection.used[0].dataset.level)
                    if demographic else level_mismatch(cohort, rank.level, "ranks"))
        if blockers:
            unavailable.extend((GRID, reason) for reason in blockers)
            return plan()
    mode = config.comparison.mode
    scenario = config.scenarios[0] if mode != "compare" else None
    respondent_filters = _filters(config.filters) if demographic else []
    if cohort is not None and demographic:
        respondent_filters = [*respondent_filters, respondent_filter(cohort)]
    # Round arithmetic needs the same seats in both rounds, as for grid compare cards.
    geographic = not demographic or any(f in SEAT_DIMENSIONS for f in rank.partition_by)
    coverage = (choose_coverage(selection.used,
                                uses_seat_ids=demographic and any(f in ("ac_num", "pc_num") for f in rank.partition_by),
                                geographic=geographic,
                                version_mode=ctx.version_mode)
                if mode == "compare" else "independent")
    reference_observation = (selection.reference.obs_id
                             if coverage == "common" and selection.reference else None)

    def job(key: str, used: list[ResolvedRound], round_: ResolvedRound | None,
            comparisons: list[dict], comparison_id: str | None) -> EngineJob:
        request = build_request(
            state=ctx.state, rounds=used, scenarios=list(config.scenarios), grouping_sets=[],
            preset=preset, comparisons=comparisons, coverage_mode=coverage,
            filters=respondent_filters, reference_observation=reference_observation)
        survey_level = used[0].dataset.level
        ranking = _ranking(config, round_, scenario, comparison_id, survey_level, cohort)
        return EngineJob(key, "analysis", GRID, view_config(request, preset, ranking=ranking))

    if mode == "compare":
        compared = _comparison(config, selection)
        return plan([job("rank", selection.used, None, [compared], compared["id"])])
    if mode == "trend":
        return plan([job(f"rank:{r.obs_id}", [r], r, [], None) for r in selection.used])
    return plan([job("rank", selection.used, selection.used[0], [], None)])
