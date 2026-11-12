"""Compile a relationship CardConfig into one engine job (spec section 5).

No number is computed here. The job asks the engine for one origin-to-destination matrix per
round, on the base joint weight, with the survey's default alliance mapping on both axes.
"""
from __future__ import annotations

import logging

from matbodh_dashboard.capability import resolve_anchor, template_blockers
from matbodh_dashboard.cards.benchmark.parties import AllianceUnavailable, MajorPartyProvider
from matbodh_dashboard.cards.compile import GRID, _by_base_name
from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.compiler.plan import EngineJob, RunPlan, field_available
from matbodh_dashboard.compiler.requests import build_request, view_config
from matbodh_dashboard.compiler.rounds import resolve_rounds
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import MethodPreset

log = logging.getLogger(__name__)


def relationship_majors(state: str, preset: MethodPreset, parties: MajorPartyProvider) -> frozenset[str]:
    """The alliance identities of the survey: the only parties the card shows."""
    return parties.identities(state, preset.alliance_reporting_type)


def compile_relationship_card(config: CardConfig, ctx: StateContext, catalogue: Catalogue,
                              preset: MethodPreset, *, parties: MajorPartyProvider | None) -> RunPlan:
    rel = config.relationship
    rounds = resolve_rounds(ctx, catalogue)
    anchor = resolve_anchor(ctx, catalogue)
    unavailable: list[tuple[str, str]] = []
    not_asked: list[tuple[str, tuple[str, ...]]] = []

    def plan(jobs=()) -> RunPlan:
        return RunPlan(card_id=config.id, state=ctx.state, rounds=tuple(rounds), anchor=anchor,
                       compare=ctx.compare_round, jobs=tuple(jobs), unavailable=tuple(unavailable),
                       not_asked=tuple(not_asked))

    fields = list(dict.fromkeys(d for cut in config.cuts for d in cut))
    unavailable.extend((GRID, r) for r in template_blockers(config.requires.min_level, fields, ctx.level))
    if parties is None:
        unavailable.append((GRID, "The alliance party lookup is not configured"))
    if unavailable:
        return plan()

    scenarios = [rel.origin, rel.destination]
    anchor_round = _by_base_name(rounds, anchor)
    unavailable.extend((GRID, f"Scenario {s!r} was not asked in {anchor}")
                       for s in scenarios if s not in anchor_round.dataset.scenarios)
    if unavailable:
        return plan()

    used = [r for r in rounds if all(s in r.dataset.scenarios for s in scenarios)]
    skipped = tuple(r.identity.base_name for r in rounds if r not in used)
    if skipped:
        not_asked.append((GRID, skipped))
    for field in fields:
        missing = [r.identity.base_name for r in used if not field_available(r.dataset, field)]
        if missing:
            unavailable.append((GRID, f"Field {field!r} needs to exist in every included round; "
                                      f"missing in: {', '.join(missing)}"))
    if unavailable:
        return plan()

    try:
        majors = relationship_majors(ctx.state, preset, parties)
    except ValueError as exc:  # the engine's verdict, e.g. no alliance context for this survey
        unavailable.append((GRID, f"Alliance mapping: {exc}"))
        return plan()
    except AllianceUnavailable:  # the cause may carry hosts or settings: log it, do not show it
        log.warning("alliance mapping unavailable for %s", ctx.state, exc_info=True)
        unavailable.append((GRID, "The alliance mapping could not be loaded; try again shortly"))
        return plan()
    if not majors:
        unavailable.append((GRID, "The alliance mapping gives no parties"))
    elif rel.focal_party is not None and rel.focal_party not in majors:
        unavailable.append((GRID, f"Focal party {rel.focal_party!r} is not a major party in the "
                                  "alliance mapping"))
    if unavailable:
        return plan()

    request = build_request(state=ctx.state, rounds=used, scenarios=scenarios,
                            grouping_sets=config.cuts, preset=preset, other_grouping=False,
                            coverage_mode="independent")
    operation: dict = {
        # Not the card id: cards that differ only in their view must share one fingerprint.
        "id": "relationship", "origin": rel.origin, "destination": rel.destination,
        "weights": {"source": "base"}, "focal_party": rel.focal_party,
    }
    if any(rel.include_recalled.values()):
        operation["answer_overrides"] = {endpoint: {"include": list(statuses)}
                                         for endpoint, statuses in rel.include_recalled.items() if statuses}
    return plan([EngineJob("relationship", "relationship", GRID,
                           view_config(request, preset, relationship=operation))])
