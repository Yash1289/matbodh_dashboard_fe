"""Survey-level capability table and context validation against the catalogue."""

from __future__ import annotations

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
    "zone": Capabilities(frozenset(), frozenset(), frozenset({"extrapolated"})),
    "state": Capabilities(frozenset(), frozenset(), frozenset({"extrapolated"})),
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

    found = []
    for name in ctx.rounds:
        try:
            found.append((name, catalogue.find(ctx.state, name)))
        except KeyError:
            errors.append(f"unknown round {name!r} for state {ctx.state!r}")

    if found:
        first_name, first = found[0]
        mixed = next(((n, r) for n, r in found if r.level != first.level), None)
        if mixed is not None:
            errors.append(
                f"rounds must share one level: {first_name!r} is {first.level!r} "
                f"but {mixed[0]!r} is {mixed[1].level!r}"
            )
        elif first.level != ctx.level:
            errors.append(
                f"context level {ctx.level!r} does not match rounds' level "
                f"{first.level!r}"
            )

    for field in ("compare_round", "anchor_round"):
        value = getattr(ctx, field)
        if value is not None and value not in ctx.rounds:
            errors.append(f"{field} {value!r} must be one of the selected rounds")

    if ctx.version_mode not in capabilities(ctx.level).version_modes:
        errors.append(
            f"version mode {ctx.version_mode!r} is not available at level "
            f"{ctx.level!r}"
        )
    return errors


def resolve_anchor(ctx: StateContext, catalogue: Catalogue) -> str:
    """Explicit anchor, else the latest selected round by catalogue sort key."""
    if ctx.anchor_round is not None:
        return ctx.anchor_round
    if not ctx.rounds:
        raise ValueError("cannot resolve anchor without selected rounds")
    rounds = [catalogue.find(ctx.state, name) for name in ctx.rounds]
    return max(rounds, key=lambda r: r.identity.sort_key).identity.base_name
