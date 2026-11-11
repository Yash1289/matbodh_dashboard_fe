"""Compile a benchmark CardConfig into one engine job (spec section 6).

No number is computed here. The engine view config carries the survey target, an optional
survey or election reference, and the major parties taken from the alliance mapping.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence

from matbodh_dashboard.capability import resolve_anchor, template_blockers
from matbodh_dashboard.cards.benchmark.parties import ElectionOption, MajorPartyProvider
from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
from matbodh_dashboard.cards.compile import GRID, _by_base_name, _endpoint_round
from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.compiler.plan import EngineJob, RunPlan
from matbodh_dashboard.compiler.requests import build_request, view_config
from matbodh_dashboard.compiler.rounds import resolve_rounds
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import MethodPreset


def default_reference(ctx: StateContext) -> BenchmarkReference:
    return BenchmarkReference(kind="compare" if ctx.compare_round else "none")


def benchmark_endpoint_parties(state: str, preset: MethodPreset, reference: BenchmarkReference,
                               parties: MajorPartyProvider) -> dict[str, frozenset[str]]:
    """The alliance-mapped identities of each endpoint: `target`, plus `reference` when there is one.

    A compare-round reference is a survey of the same state, so it shares the survey mapping.
    """
    survey = parties.identities(state, preset.alliance_reporting_type)
    out = {"target": survey}
    if reference.kind == "compare":
        out["reference"] = survey
    elif reference.kind == "election":
        out["reference"] = parties.identities(state, preset.alliance_reporting_type,
                                              year=reference.year, election_type=reference.election_type)
    return out


def endpoint_parties_of(job_config: Mapping, state: str, preset: MethodPreset,
                        parties: MajorPartyProvider) -> dict[str, frozenset[str]]:
    """The same sets, recovered from a compiled job config (the runner has no context)."""
    ref = job_config["benchmark"]["reference"]
    if ref is None:
        reference = BenchmarkReference(kind="none")
    elif ref["source"] == "election":
        reference = BenchmarkReference(kind="election", **ref["context"])
    else:
        reference = BenchmarkReference(kind="compare")
    return benchmark_endpoint_parties(state, preset, reference, parties)


def compile_benchmark_card(config: CardConfig, ctx: StateContext, catalogue: Catalogue,
                           preset: MethodPreset, *, reference: BenchmarkReference | None,
                           parties: MajorPartyProvider | None,
                           elections: Mapping[str, Sequence[ElectionOption]] | None) -> RunPlan:
    rounds = resolve_rounds(ctx, catalogue)
    anchor = resolve_anchor(ctx, catalogue)
    unavailable: list[tuple[str, str]] = []

    def plan(jobs=()) -> RunPlan:
        return RunPlan(card_id=config.id, state=ctx.state, rounds=tuple(rounds), anchor=anchor,
                       compare=ctx.compare_round, jobs=tuple(jobs), unavailable=tuple(unavailable))

    ref = reference or default_reference(ctx)
    unavailable.extend((GRID, r) for r in template_blockers(config.requires.min_level, [], ctx.level))
    if ctx.level not in ("ac", "pc"):
        unavailable.append((GRID, "Benchmarks need an AC- or PC-level survey"))
    if parties is None:
        unavailable.append((GRID, "The alliance party lookup is not configured"))
    if unavailable:
        return plan()

    scenario = config.scenarios[0]
    target = _by_base_name(rounds, anchor)
    if scenario not in target.dataset.scenarios:
        unavailable.append((GRID, f"Scenario {scenario!r} was not asked in {anchor}"))
    reference_round = None
    if ref.kind == "compare":
        reference_round, error = _endpoint_round("compare", rounds, anchor, ctx)
        if error:
            unavailable.append((GRID, error))
        elif reference_round.obs_id == target.obs_id:
            unavailable.append((GRID, "The comparison round is the anchor round; choose a different one"))
        elif scenario not in reference_round.dataset.scenarios:
            unavailable.append((GRID, f"Scenario {scenario!r} was not asked in "
                                      f"{reference_round.identity.base_name}"))
    elif ref.kind == "election" and not any(
            (o.year, o.election_type) == (ref.year, ref.election_type)
            for o in (elections or {}).get(ctx.state, ())):
        unavailable.append((GRID, f"Election {ref.year} {ref.election_type} is not listed for {ctx.state}"))
    if unavailable:
        return plan()

    try:
        endpoint_parties = benchmark_endpoint_parties(ctx.state, preset, ref, parties)
    except ValueError as exc:  # the engine's verdict, e.g. no alliance context for that election
        unavailable.append((GRID, f"Alliance mapping: {exc}"))
        return plan()
    majors = sorted(frozenset().union(*endpoint_parties.values()))
    focal = config.benchmark.focal_party
    if not majors:
        unavailable.append((GRID, "The alliance mapping gives no parties"))
    elif focal is not None and focal not in majors:
        unavailable.append((GRID, f"Focal party {focal!r} is not a major party in the alliance mapping "
                                  "and would be folded into Other"))
    elif focal is not None and any(focal not in names for names in endpoint_parties.values()):
        # The engine returns a zero for a party one endpoint does not map; margins and flips would show it.
        unavailable.append((GRID, f"Focal party {focal!r} must be mapped for every endpoint; "
                                  "its margins and flips would otherwise be wrong"))
    if unavailable:
        return plan()

    other = {"keep": list(majors), "label": preset.other_label}
    if ref.kind == "election":
        reference_endpoint = {
            "source": "election", "id": "reference",
            "context": {"year": ref.year, "election_type": ref.election_type},
            # Unmapped historical parties compete individually (spec section 3, rule 5).
            "parties": {"passthrough": True, "options": [], "other_grouping": other},
        }
    elif reference_round is not None:
        reference_endpoint = {"source": "survey", "id": "reference",
                              "observation": reference_round.obs_id, "scenario": scenario}
    else:
        reference_endpoint = None
    wanted = {target.obs_id, *([reference_round.obs_id] if reference_round else [])}
    request = build_request(state=ctx.state, rounds=[r for r in rounds if r.obs_id in wanted],
                            scenarios=[scenario], grouping_sets=[], preset=preset, keep=majors)
    benchmark = {
        # Not the card id: cards that differ only in their view must share one fingerprint.
        "id": "benchmark", "seat_level": ctx.level,
        "target": {"source": "survey", "id": "target", "observation": target.obs_id,
                   "scenario": scenario},
        "reference": reference_endpoint,
        "contenders": list(majors), "focal_party": focal,
        "grouping_sets": [list(gs) for gs in config.benchmark.grouping_sets],
        "filters": [], "seat_ids": [],
        "competition_excluded": list(preset.competition_excluded),
    }
    return plan([EngineJob("benchmark", "benchmark", GRID,
                           view_config(request, preset, benchmark=benchmark))])
