"""Resolve a state's selected rounds to concrete dataset versions."""

from __future__ import annotations

from collections.abc import Sequence
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
    try:
        labels = short_labels([r.identity for r in found])
    except ValueError:  # ambiguous short labels: the full base name is unambiguous
        labels = {r.identity: r.identity.base_name for r in found}
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


def trend_rounds(
    rounds: Sequence[ResolvedRound], anchor: str, count: int | None, surveys: Sequence[str] = ()
) -> tuple[list[ResolvedRound], str | None]:
    """The rounds a trend reads: the surveys the card chose (in the context's order), else the pipe window."""
    if surveys:
        chosen = set(surveys)
        return [r for r in rounds if r.identity.base_name in chosen], None
    return pipe_window(rounds, anchor, count)


def pipe_window(
    rounds: Sequence[ResolvedRound], anchor: str, count: int | None
) -> tuple[list[ResolvedRound], str | None]:
    """The last `count` rounds up to and including the anchor (spec section 4), in round order.

    `count=None` keeps every round. A count follows the context when it changes; if fewer rounds
    exist than asked for, all of them are read and the note says so.
    """
    if count is None:
        return list(rounds), None
    upto = list(rounds)
    for index, round_ in enumerate(rounds):
        if round_.identity.base_name == anchor:
            upto = list(rounds[: index + 1])
            break
    note = f"showing {len(upto)} of the {count} rounds asked for" if len(upto) < count else None
    return upto[-count:], note
