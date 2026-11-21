"""Option lists for Configure, from metadata for the rounds the draft card reads (spec 7).

The draft travels with every request so the rounds read follow the same selection the compilers
use: mode, pipe-round count, chosen scenarios and the benchmark reference. Lists never invent a
value: scenarios and fields come from the catalogue and the engine's field catalogue, parties from
the preset or the alliance mapping, elections from config/elections.yaml.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from functools import lru_cache
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from matbodh_dashboard.capability import anchor_level, card_blockers, resolve_anchor
from matbodh_dashboard.cards.benchmark.compile import benchmark_endpoint_parties
from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
from matbodh_dashboard.cards.config import (
    OPINION_MEASURES, PARTY_MEASURES, SEGMENT_FIELDS, _scenario_catalogue, party_scenarios_of, scenario_kind,
)
from matbodh_dashboard.cards.relationship.compile import relationship_majors
from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.compiler.plan import field_available, master_key_of
from matbodh_dashboard.compiler.rounds import ResolvedRound, pipe_window, resolve_rounds
from matbodh_dashboard.context import StateContext

METRIC_LABELS = {"support_share": "Support share", "net_score": "Net score",
                 "positive_share": "Positive share", "negative_share": "Negative share"}


class OptionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: str
    label: str
    kind: str | None = None
    recalled: bool = False
    disabled_reason: str | None = None
    # Fields only: does the field describe the seat (a result slicer when first in a cut) or the respondent?
    scope: Literal["seat", "respondent"] | None = None


def _get(draft: Mapping[str, Any], path: str) -> Any:
    node: Any = draft
    for part in path.split("."):
        if isinstance(node, list) and part.isdigit():
            node = node[int(part)] if int(part) < len(node) else None
        elif isinstance(node, Mapping):
            node = node.get(part)
        else:
            return None
    return node


def _by_name(rounds: list[ResolvedRound], name: str | None) -> ResolvedRound | None:
    return next((r for r in rounds if r.identity.base_name == name), None)


def _asking(rounds: list[ResolvedRound], scenarios: list[str]) -> list[ResolvedRound]:
    """Rounds that asked every given scenario (the compilers drop the others as not asked)."""
    return [r for r in rounds if all(s in r.dataset.scenarios for s in scenarios)] if scenarios else rounds


def _card_ctx(draft: Mapping[str, Any], ctx: StateContext) -> StateContext:
    """The draft's own anchor/compare survey in place of the context's (a name outside the context is
    ignored here; validation reports it)."""
    surveys = draft.get("surveys") or []
    wanted = {"anchor_round": surveys[0] if len(surveys) == 1 else draft.get("anchor_round"),
              "compare_round": draft.get("compare_round")}
    return ctx.model_copy(update={k: v for k, v in wanted.items() if v in ctx.rounds})


def rounds_read(draft: Mapping[str, Any], ctx: StateContext, catalogue: Catalogue) -> list[ResolvedRound]:
    """The rounds this draft would read, in round order (mirrors the compilers' round selection)."""
    ctx = _card_ctx(draft, ctx)
    rounds = resolve_rounds(ctx, catalogue)
    anchor = resolve_anchor(ctx, catalogue)
    anchor_round = _by_name(rounds, anchor)
    family = draft.get("family")
    if family == "relationship":
        window, _ = pipe_window(rounds, anchor, draft.get("pipe_rounds"))
        ends = [s for s in (_get(draft, "relationship.origin"), _get(draft, "relationship.destination")) if s]
        return _asking(window, ends)
    if family == "seat_benchmark":
        raw = _get(draft, "benchmark.reference")
        kind = raw.get("kind") if isinstance(raw, Mapping) else ("compare" if ctx.compare_round else "none")
        compare = _by_name(rounds, ctx.compare_round) if kind == "compare" else None
        return [r for r in rounds if r is anchor_round or r is compare]
    mode = _get(draft, "comparison.mode") or "standalone"
    if mode == "trend":
        window, _ = pipe_window(rounds, anchor, draft.get("pipe_rounds"))
        scenario = _get(draft, "scenarios.0")
        return _asking(window, [scenario] if scenario else [])
    if mode == "compare":
        names = {"anchor": anchor, "compare": ctx.compare_round}
        wanted = {names.get(_get(draft, f"comparison.{end}.round") or "anchor") for end in ("target", "reference")}
        return [r for r in rounds if r.identity.base_name in wanted]
    chosen = draft.get("surveys") or []
    if len(chosen) > 1:
        return [r for r in rounds if r.identity.base_name in chosen]
    return [anchor_round]


def _missing(rounds: list[ResolvedRound], present: Callable[[ResolvedRound], bool], what: str) -> str | None:
    absent = [r.identity.base_name for r in rounds if not present(r)]
    return f"{what} is not in {', '.join(absent)}" if absent else None


# -- sources ------------------------------------------------------------------------------------------

def _scenarios(params, draft, ctx, service) -> list[OptionItem]:
    read = rounds_read(draft, ctx, service.catalogue)
    anchor = _by_name(resolve_rounds(ctx, service.catalogue), resolve_anchor(ctx, service.catalogue))
    wanted = params.get("kind", "any")
    allowed_party = set(party_scenarios_of(anchor.dataset.scenarios))  # Q-11: no external weights
    catalogue = _scenario_catalogue()
    out = []
    for scenario in sorted(anchor.dataset.scenarios):
        try:
            kind = scenario_kind(scenario)
        except ValueError:  # not in the engine catalogue: never guessed
            continue
        if (kind == "party" and scenario not in allowed_party) or wanted not in ("any", kind):
            continue
        reason = (_missing(read, lambda r: scenario in r.dataset.scenarios, "This question")
                  if params.get("scope") == "all_read" else None)
        out.append(OptionItem(value=scenario, label=scenario, kind=kind,
                              recalled=catalogue[scenario].role == "recalled_vote", disabled_reason=reason))
    return out


def _metrics(params, draft, ctx, service) -> list[OptionItem]:
    path = "comparison.target.scenario" if _get(draft, "comparison.mode") == "compare" else "scenarios.0"
    scenario = _get(draft, path)
    if not scenario:
        return []
    measures = PARTY_MEASURES if scenario_kind(scenario) == "party" else OPINION_MEASURES
    return [OptionItem(value=m, label=METRIC_LABELS[m]) for m in measures]


LEVEL_TAGS = {"ac": "AC", "pc": "PC", "zone": "Zone", "state": "State-wide"}


def _surveys(params, draft, ctx, service) -> list[OptionItem]:
    """Every survey of the context with its level; seat cards (params seat=true) only AC and PC ones."""
    seat_only = params.get("seat") is True
    return [OptionItem(value=r.identity.base_name, label=f"{r.identity.base_name} · {LEVEL_TAGS[r.dataset.level]}")
            for r in resolve_rounds(ctx, service.catalogue) if not seat_only or r.dataset.level in ("ac", "pc")]


@lru_cache(maxsize=1)
def _engine_fields() -> dict:
    from matbodh_dash.catalog import default_fields

    return default_fields()


@lru_cache(maxsize=1)
def _pc_attributes() -> frozenset[str]:
    from matbodh_dash.mysql_access import PC_ATTRIBUTES

    return frozenset(PC_ATTRIBUTES) | {"zone"}


def _fields(params, draft, ctx, service) -> list[OptionItem]:
    use = params.get("use", "cut")
    read = rounds_read(draft, ctx, service.catalogue)
    level = anchor_level(ctx, service.catalogue)
    levels = {r.dataset.level for r in read} or {level}
    seat_level = (_get(draft, "rank.level") if draft.get("family") == "seat_ranking" else None) or level
    seats = len(levels) == 1 and levels <= {"ac", "pc"}
    # Zone and state collections reach a master through their stored seat number.
    has_key = {key: all(key in r.dataset.fields for r in read if r.dataset.level in ("zone", "state"))
               for key in ("ac_num", "pc_num")}
    out = []
    for name, spec in sorted(_engine_fields().items()):
        if name in SEGMENT_FIELDS or name == "state" or spec.cardinality != "single":
            continue
        geographic = spec.role == "geographic_attribute" or (spec.role == "seat_attribute" and spec.geography)
        if geographic and use != "seat_attribute" and card_blockers("state", [name], sorted(levels), mixed_ok=True):
            continue  # respondent cuts follow the capability table, as the compiler does
        if spec.role == "seat_attribute":
            if use in ("cut", "filter") and (levels - {"ac", "pc"} or len(levels) > 1):
                # Several levels, or a zone or state-wide survey, are read: the attribute joins its master on the stored seat number,
                # and a PC survey cannot resolve an AC-keyed attribute.
                key = master_key_of(name)
                if not has_key[key] or (key == "ac_num" and "pc" in levels):
                    continue
            elif not seats or (seat_level == "pc" and spec.master_attribute not in _pc_attributes()):
                continue
        if use == "level" and spec.role != "profiling":
            continue
        if use == "partition" and spec.role == "profiling":
            continue
        if use == "seat_attribute" and spec.role != "seat_attribute":
            continue
        if use == "cut" and params.get("family") == "gender_differential" and name == service.preset.gender.field:
            continue
        if spec.source != "master" and not any(name in r.dataset.fields for r in read):
            continue  # a survey field none of the read rounds has
        reason = _missing(read, lambda r: field_available(r.dataset, name), "This field")
        scope = "seat" if spec.role in ("seat_attribute", "geographic_attribute") else "respondent"
        out.append(OptionItem(value=name, label=name, disabled_reason=reason, scope=scope))
    return out


def _joint_weight_scenarios(params, draft, ctx, service) -> list[OptionItem]:
    read = rounds_read(draft, ctx, service.catalogue)
    catalogue = _scenario_catalogue()
    candidates = sorted({s for r in read for s in r.dataset.scenarios})
    out = []
    for scenario in candidates:
        spec = catalogue.get(scenario)
        if spec is None or spec.domain != "party" or not spec.weight_keys:
            continue
        reason = _missing(read, lambda r: scenario in r.dataset.scenarios, "This question")
        out.append(OptionItem(value=scenario, label=scenario, kind="party", disabled_reason=reason))
    return out


def _reference(draft, ctx) -> BenchmarkReference:
    raw = _get(draft, "benchmark.reference")
    if isinstance(raw, Mapping):
        return BenchmarkReference.model_validate(raw)
    return BenchmarkReference(kind="compare" if ctx.compare_round else "none")


def _parties(params, draft, ctx, service) -> list[OptionItem]:
    use = params.get("use")
    preset = service.preset
    if use == "hide":
        return [OptionItem(value=p, label=p) for p in [*preset.keep, preset.other_label]]
    if use == "rank":
        return [OptionItem(value=p, label=p) for p in preset.keep]
    if service.major_parties is None:
        raise ValueError("The alliance party lookup is not configured")
    if draft.get("family") != "seat_benchmark":
        return [OptionItem(value=p, label=p) for p in sorted(relationship_majors(ctx.state, preset,
                                                                               service.major_parties))]
    endpoints = benchmark_endpoint_parties(ctx.state, preset, _reference(draft, ctx), service.major_parties)
    majors = sorted(frozenset().union(*endpoints.values()))
    out = []
    for party in majors:
        unmapped = use == "focal" and any(party not in names for names in endpoints.values())
        out.append(OptionItem(value=party, label=party,
                              disabled_reason="not mapped for every endpoint" if unmapped else None))
    return out


def _elections(params, draft, ctx, service) -> list[OptionItem]:
    anchor = resolve_anchor(ctx, service.catalogue)
    no_compare = (None if ctx.compare_round and ctx.compare_round != anchor
                  else "Choose a comparison round other than the anchor in the context")
    return [
        OptionItem(value="none", label="Nothing"),
        OptionItem(value="compare", label="The comparison round", disabled_reason=no_compare),
        *(OptionItem(value=f"election:{o.year}:{o.election_type}", label=o.label)
          for o in service.elections.get(ctx.state, ())),
    ]


SOURCES: dict[str, Callable[..., list[OptionItem]]] = {
    "scenarios": _scenarios, "surveys": _surveys, "metrics": _metrics, "fields": _fields,
    "joint_weight_scenarios": _joint_weight_scenarios, "parties": _parties, "elections": _elections,
}


def options_for(source: str, params: Mapping[str, Any], draft: Mapping[str, Any], ctx: StateContext,
                service) -> list[OptionItem]:
    """One option list; KeyError for an unknown source."""
    if source not in SOURCES:
        raise KeyError(f"unknown option source {source!r}")
    ctx = _card_ctx(draft, ctx)  # every list follows the card's own anchor / comparison survey
    return SOURCES[source](dict(params), dict(draft), ctx, service)
