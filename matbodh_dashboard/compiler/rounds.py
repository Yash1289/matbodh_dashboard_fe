"""Resolve a state's selected rounds to concrete dataset versions."""

from __future__ import annotations

from dataclasses import dataclass

from matbodh_dashboard.catalogue.labels import RoundIdentity, short_labels
from matbodh_dashboard.catalogue.store import Catalogue, DatasetVersion
from matbodh_dashboard.context import StateContext


@dataclass(frozen=True)
class ResolvedRound:
    obs_id: str
    label: str
    identity: RoundIdentity
    dataset: DatasetVersion
    fallback: bool


def resolve_rounds(ctx: StateContext, catalogue: Catalogue) -> list[ResolvedRound]:
    """Resolve rounds in metadata sort order as observations o1..oN.

    Extrapolated falls back to Normal when absent (fallback=True); matched
    mode always uses Normal.
    """
    found = [catalogue.find(ctx.state, name) for name in ctx.rounds]
    found.sort(key=lambda r: r.identity.sort_key)
    labels = short_labels([r.identity for r in found])
    resolved = []
    for index, cat_round in enumerate(found, start=1):
        dataset, fallback = cat_round.version(ctx.version_mode)
        resolved.append(
            ResolvedRound(
                obs_id=f"o{index}",
                label=labels[cat_round.identity],
                identity=cat_round.identity,
                dataset=dataset,
                fallback=fallback,
            )
        )
    return resolved
