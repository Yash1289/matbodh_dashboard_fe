"""Survey-level capability table and context validation against the catalogue."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.context import StateContext


@dataclass(frozen=True)
class Capabilities:
    geo_slices: frozenset[str]
    seat_levels: frozenset[str]
    version_modes: frozenset[str]


_BOTH_VERSIONS = frozenset({"extrapolated", "matched"})
_CAPABILITIES = {
    "ac": Capabilities(
        frozenset({"zone", "party_zone", "district", "pc_num", "ac_num"}),
        frozenset({"ac", "pc"}),
        _BOTH_VERSIONS,
    ),
    "pc": Capabilities(
        frozenset({"pc_zone", "pc_num"}), frozenset({"pc"}), _BOTH_VERSIONS
    ),
    # Zone and state collections store AC numbers, so the AC master supplies zone and district
    # (engine validation.CAPABILITIES); they support no seat identifier.
    "zone": Capabilities(frozenset({"zone", "party_zone", "district"}), frozenset(), frozenset({"extrapolated"})),
    "state": Capabilities(frozenset({"zone", "party_zone", "district"}), frozenset(), frozenset({"extrapolated"})),
}


# Coarse to fine; a template's requires.min_level is met by its level or finer.
LEVEL_RANK = {"state": 0, "zone": 1, "pc": 2, "ac": 3}
# Every geographic slice some level supports; other slices are demographic.
GEO_SLICES = frozenset().union(*(c.geo_slices for c in _CAPABILITIES.values()))


def template_blockers(min_level: str, slices: list[str], level: str) -> list[str]:
    """Reasons a template cannot run at a survey level; empty when it can."""
    reasons = []
    if LEVEL_RANK[level] < LEVEL_RANK[min_level]:
        reasons.append(f"Needs a {min_level.upper()}-level survey; this survey is "
                       f"{level.upper()} level")
    allowed = capabilities(level).geo_slices
    for slice_ in slices:
        if slice_ in GEO_SLICES and slice_ not in allowed:
            reasons.append(f"Slice {slice_!r} is not available for {level.upper()}-level "
                           f"surveys")
    return reasons


# Seat identifiers: an AC/PC estimate, so every survey read must share one level.
SEAT_SLICES = frozenset({"ac_num", "pc_num"})


def card_blockers(min_level: str, slices: Sequence[str], levels: Sequence[str], *,
                  mixed_ok: bool) -> list[str]:
    """Reasons a card cannot read surveys of these levels with these cuts; empty when it can.

    Cards that are not `mixed_ok` read one level (the engine paths for them are unverified across
    levels). `mixed_ok` cards may read several, but each geographic cut must be allowed at every one
    of them and seat identifiers need a single level."""
    distinct = sorted(set(levels), key=LEVEL_RANK.get, reverse=True)
    if not distinct:
        return []
    if not mixed_ok:
        return [*round_level_blockers(levels), *template_blockers(min_level, list(slices), distinct[0])]
    reasons = []
    for level in distinct:
        reasons.extend(template_blockers(min_level, list(slices), level))
    if len(distinct) > 1 and SEAT_SLICES & set(slices):
        names = ", ".join(level.upper() for level in distinct)
        reasons.append(f"Seat identifiers need surveys of one level; this card reads {names}")
    return list(dict.fromkeys(reasons))


def capabilities(level: str) -> Capabilities:
    try:
        return _CAPABILITIES[level]
    except KeyError:
        raise ValueError(f"unknown survey level {level!r}") from None


def validate_context(ctx: StateContext, catalogue: Catalogue) -> list[str]:
    """Return human-readable errors; an empty list means the context is valid."""
    errors: list[str] = []
    if not ctx.rounds:
        errors.append("at least one round must be selected")
    duplicates = sorted({name for name in ctx.rounds if ctx.rounds.count(name) > 1})
    if duplicates:
        errors.append(f"duplicate rounds selected: {', '.join(map(repr, duplicates))}")
    if ctx.geo_scope != "state":
        errors.append(f"geo_scope {ctx.geo_scope!r} is not supported yet; use 'state'")

    found = []
    for name in ctx.rounds:
        try:
            found.append((name, catalogue.find(ctx.state, name)))
        except KeyError:
            errors.append(f"unknown round {name!r} for state {ctx.state!r}")

    for field in ("compare_round", "anchor_round"):
        value = getattr(ctx, field)
        if value is not None and value not in ctx.rounds:
            errors.append(f"{field} {value!r} must be one of the selected rounds")

    if len(found) == len(ctx.rounds) and ctx.compare_round in ctx.rounds:
        anchor = ctx.anchor_round
        if anchor is None:
            anchor = max(found, key=lambda f: f[1].identity.sort_key)[0]
        if ctx.compare_round == anchor:
            errors.append(f"compare_round {ctx.compare_round!r} is the anchor round; "
                          f"choose a different round to compare with")

    for name, round_ in found:
        if ctx.version_mode not in capabilities(round_.level).version_modes:
            errors.append(
                f"version mode {ctx.version_mode!r} is not available for {name!r} "
                f"({round_.level} level)"
            )
    if ctx.version_mode == "matched":
        for name, round_ in found:
            if round_.normal is None:
                errors.append(f"matched mode needs a Normal dataset; round {name!r} "
                              f"has only an Extrapolated one")
    return errors


def resolve_anchor(ctx: StateContext, catalogue: Catalogue) -> str:
    """Explicit anchor, else the latest selected round by catalogue sort key."""
    if ctx.anchor_round is not None:
        return ctx.anchor_round
    if not ctx.rounds:
        raise ValueError("cannot resolve anchor without selected rounds")
    rounds = [catalogue.find(ctx.state, name) for name in ctx.rounds]
    return max(rounds, key=lambda r: r.identity.sort_key).identity.base_name


def anchor_level(ctx: StateContext, catalogue: Catalogue) -> str:
    """The survey level of the context's anchor round."""
    return catalogue.level_of(ctx.state, resolve_anchor(ctx, catalogue))


def round_level_blockers(levels: Sequence[str]) -> list[str]:
    """Reasons a card cannot read surveys of these levels together; empty for one level."""
    distinct = sorted(set(levels), key=LEVEL_RANK.get, reverse=True)
    if len(distinct) < 2:
        return []
    names = ", ".join(level.upper() for level in distinct)
    return [f"This card reads surveys of different levels ({names}); choose surveys of one level"]
