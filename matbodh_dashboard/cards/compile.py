"""Compile a CardConfig plus context into one engine job (spec section 6.2).

No engine arithmetic happens here: the card says which comparisons to ask for, the
engine computes them. Fixed numerical policy comes from the admin preset.
"""
from __future__ import annotations

from dataclasses import dataclass

from matbodh_dashboard.capability import card_blockers, resolve_anchor, validate_context
from matbodh_dashboard.cards.config import (
    party_scenarios_of,
    BENCHMARK_FAMILIES,
    RANKING_FAMILIES,
    RELATIONSHIP_FAMILIES,
    MIXED_LEVEL_FAMILIES,
    SEAT_DIMENSIONS,
    CardConfig,
    comparison_kind,
    scenario_kind,
)
from matbodh_dashboard.cards.context import card_context
from matbodh_dashboard.cards.families import get_family
from matbodh_dashboard.cohorts.restrict import cohort_blockers, respondent_filter
from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.compiler.coverage import choose_coverage
from matbodh_dashboard.compiler.plan import EngineJob, RunPlan, field_available, master_key_of
from matbodh_dashboard.compiler.requests import build_request, comparison, view_config
from matbodh_dashboard.compiler.rounds import ResolvedRound, pipe_window, resolve_rounds, trend_rounds
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import MethodPreset

GRID = "grid"
MAX_TREND_ROUNDS = 4


@dataclass
class _Selection:
    used: list[ResolvedRound]
    target: ResolvedRound | None = None
    reference: ResolvedRound | None = None


def windowed(config: CardConfig, rounds: list[ResolvedRound], anchor: str) -> tuple[list[ResolvedRound], tuple[str, ...]]:
    """The rounds a card reads: its pipe-round window for trends and relationships, else all."""
    custom = config.comparison.mode == "trend" and len(config.surveys) > 1
    if not custom and (config.pipe_rounds is None or not (
            config.comparison.mode == "trend" or config.family in RELATIONSHIP_FAMILIES)):
        return list(rounds), ()
    window, note = trend_rounds(rounds, anchor, config.pipe_rounds, config.surveys if config.comparison.mode == "trend" else ())
    return window, ((note,) if note else ())


def compare_in(rounds: list[ResolvedRound], name: str | None) -> str | None:
    """The comparison round, unless this card's window left it out."""
    return name if any(r.identity.base_name == name for r in rounds) else None


def read_levels(config: CardConfig, ctx: StateContext, rounds: list[ResolvedRound], anchor: str) -> list[str]:
    """Survey levels of the rounds this card actually reads: the anchor, the comparison round in
    compare mode, and the whole window in trend (and relationship) cards."""
    names = set(config.surveys) if len(config.surveys) > 1 else {anchor}
    if config.comparison.mode == "compare" and ctx.compare_round:
        names.add(ctx.compare_round)
    if config.comparison.mode == "trend" or config.family in RELATIONSHIP_FAMILIES:
        names.update(r.identity.base_name for r in rounds)
    return [r.dataset.level for r in rounds if r.identity.base_name in names]


def without_master_key(rounds: list[ResolvedRound], field: str) -> list[ResolvedRound]:
    """Zone and state rounds that would read `field` from a master but do not list the stored seat
    number that joins it (ac_num for AC-master attributes, pc_num for PC-keyed ones such as pc_zone)."""
    key = master_key_of(field)
    return [r for r in rounds if key is not None and r.dataset.level in ("zone", "state")
            and key not in r.dataset.fields]


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
    if mode == "standalone" and len(config.surveys) > 1:
        chosen = [_by_base_name(rounds, name) for name in config.surveys]
        for name, found in zip(config.surveys, chosen):
            if found is None:
                unavailable.append((GRID, f"Round {name!r} is not among the selected rounds"))
        if unavailable:
            return None
        # A survey that asked only some of the questions is kept for those; one that asked none is "not asked".
        asked = [r for r in chosen if any(s in r.dataset.scenarios for s in config.scenarios)]
        dropped = [r for r in chosen if r not in asked]
        if dropped:
            not_asked.append((GRID, tuple(r.identity.base_name for r in dropped)))
        if not asked:
            unavailable.append((GRID, "None of the chosen surveys asked these questions"))
        return _Selection(asked)

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


def _clubbing_blockers(config: CardConfig, selection: _Selection, anchor_round, anchor: str, fields) -> list[str]:
    """Why the anchor round cannot be the caste reference of every round the card reads; empty when it can."""
    lead = f"Club small castes uses the anchor survey {anchor}, which"
    if anchor_round is None:  # a chosen set of surveys left it out
        return [f"{lead} this card does not read; include it, or switch clubbing off"]
    reasons = []
    # The anchor is read for every job, so it needs every field the card cuts or filters by, not only category and caste.
    gone = [f for f in dict.fromkeys(["category", "caste", *fields]) if not field_available(anchor_round.dataset, f)]
    if gone:
        reasons.append(f"{lead} has no {' or '.join(gone)}")
    several = config.comparison.mode == "standalone" and len(config.surveys) > 1
    if not several and anchor_round.obs_id not in {r.obs_id for r in selection.used}:
        reasons.append(f"{lead} this card does not read; include it, or switch clubbing off")
    if several:
        for r in selection.used:
            lacking = [s for s in config.scenarios
                       if s in r.dataset.scenarios and s not in anchor_round.dataset.scenarios]
            if lacking:
                reasons.append(f"{lead} did not ask {', '.join(lacking)} (read in {r.identity.base_name}); "
                               "change the anchor, or switch clubbing off")
    return reasons


def compile_card(config: CardConfig, ctx: StateContext, catalogue: Catalogue,
                 preset: MethodPreset, *, reference=None, parties=None, elections=None,
                 cohort=None) -> RunPlan:
    try:
        overridden = card_context(config, ctx)
        if overridden is not ctx:  # the context is valid; its overridden form must be too (e.g. compare != anchor)
            errors = validate_context(overridden, catalogue)
            if errors:
                raise ValueError(errors[0])
        ctx = overridden
    except ValueError as error:
        return RunPlan(card_id=config.id, state=ctx.state, rounds=(), anchor=ctx.anchor_round or "",
                       compare=ctx.compare_round, jobs=(), unavailable=((GRID, str(error)),))
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
    anchor = resolve_anchor(ctx, catalogue)
    rounds, notes = windowed(config, resolve_rounds(ctx, catalogue), anchor)
    unavailable: list[tuple[str, str]] = []
    not_asked: list[tuple[str, tuple[str, ...]]] = []

    def plan(jobs=()) -> RunPlan:
        return RunPlan(card_id=config.id, state=ctx.state, rounds=tuple(rounds), anchor=anchor,
                       compare=compare_in(rounds, ctx.compare_round), jobs=tuple(jobs),
                       unavailable=tuple(unavailable), not_asked=tuple(not_asked), notes=notes)

    if config.all_party_scenarios:
        anchor_scenarios = party_scenarios_of(_by_base_name(rounds, anchor).dataset.scenarios)
        if not anchor_scenarios:
            unavailable.append((GRID, f"No party scenario is recorded for {anchor}"))
            return plan()
        config = config.model_copy(update={"scenarios": anchor_scenarios})
    shown = {*preset.keep, preset.other_label}  # the party rows a grid card has
    unknown = [p for p in config.display_parties if p not in shown]
    if unknown:
        unavailable.append((GRID, f"Party {unknown[0]!r} is not a party row of this card "
                                  f"({', '.join(sorted(shown))})"))
        return plan()
    fields = _needed_fields(config, preset.gender.field if spec.gender_differential else None)
    blockers = card_blockers(config.requires.min_level, fields, read_levels(config, ctx, rounds, anchor),
                             mixed_ok=config.family in MIXED_LEVEL_FAMILIES)
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
        no_key = without_master_key(selection.used, field)
        if no_key:
            unavailable.append((GRID, f"Field {field!r} needs {master_key_of(field)} in every zone or "
                                      f"state-wide round; missing in: {_names(no_key)}"))
    if unavailable:
        return plan()

    if cohort is not None:
        blockers = list(dict.fromkeys(b for r in selection.used for b in cohort_blockers(cohort, r.dataset.level)))
        if blockers:
            unavailable.extend((GRID, reason) for reason in blockers)
            return plan()
    mode = config.comparison.mode
    geographic = any(f in SEAT_DIMENSIONS for f in fields)
    coverage = (choose_coverage(selection.used, uses_seat_ids=any(f in ("ac_num", "pc_num") for f in fields),
                                geographic=geographic,
                                version_mode=ctx.version_mode)
                if mode == "compare" else "independent")
    if any(r.dataset.level in ("zone", "state") for r in selection.used):
        coverage = "independent"  # these collections have no verified AC/PC completion list
    if cohort is not None and len(selection.used) > 1:
        coverage = "common"  # rounds must be read on the same cohort seats
    reference_observation = (selection.reference.obs_id
                             if coverage == "common" and selection.reference else None)
    anchor_round = _by_base_name(rounds, anchor)
    # Caste clubbing is keyed to the anchor round for every round the card reads, so all columns share one
    # set of separate and grouped-up castes.
    clubbing_blockers = _clubbing_blockers(config, selection, anchor_round, anchor, fields) if config.caste_clubbing else []
    if clubbing_blockers:
        unavailable.extend((GRID, reason) for reason in clubbing_blockers)
        return plan()
    if config.comparison.mode == "standalone" and len(config.surveys) > 1:
        # One engine job per survey, each with the questions that survey asked (the engine requires every
        # question of a request in every observation it reads); the run merges their results.
        jobs = []
        for r in selection.used:
            request = build_request(
                state=ctx.state, rounds=[r, anchor_round] if config.caste_clubbing and r.obs_id != anchor_round.obs_id else [r],
                scenarios=[s for s in config.scenarios if s in r.dataset.scenarios],
                grouping_sets=config.cuts, preset=preset, comparisons=[], gender=spec.gender_differential,
                coverage_mode="independent",
                filters=[{"field": f.field, "operator": f.operator, "values": list(f.values)} for f in config.filters]
                + ([respondent_filter(cohort)] if cohort is not None else []),
                caste_clubbing=({"threshold_pct": preset.caste_threshold_pct, "reference_observation": anchor_round.obs_id}
                                if config.caste_clubbing else None),
                reference_observation=None, display_parties=config.display_parties)
            jobs.append(EngineJob(f"{GRID}:{r.obs_id}", "analysis", GRID, view_config(request, preset)))
        return plan(jobs)
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
                         "reference_observation": anchor_round.obs_id}
                        if config.caste_clubbing else None),
        reference_observation=reference_observation,
        display_parties=config.display_parties,
    )
    return plan([EngineJob(GRID, "analysis", GRID, view_config(request, preset))])
