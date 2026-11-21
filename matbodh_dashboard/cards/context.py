"""A card's own survey choice: its anchor and compare rounds override the context's (spec 2026-11-21).

Every compile path reads the context, so applying the override once, before compiling, makes every
family read the card's rounds without any change of its own.
"""
from __future__ import annotations

from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.context import StateContext


def card_context(config: CardConfig, ctx: StateContext) -> StateContext:
    """The context this card reads: the card's anchor/compare rounds where set, else the context's.
    Raises ValueError naming a round that is not among the context's selected rounds."""
    chosen = {"anchor_round": config.anchor_round, "compare_round": config.compare_round}
    if len(config.surveys) == 1:  # one chosen survey is simply this card's anchor
        chosen["anchor_round"] = config.surveys[0]
    chosen = {key: name for key, name in chosen.items() if name is not None}
    for name in chosen.values():
        if name not in ctx.rounds:
            raise ValueError(f"Round {name!r} is not among the selected rounds")
    return ctx.model_copy(update=chosen) if chosen else ctx
