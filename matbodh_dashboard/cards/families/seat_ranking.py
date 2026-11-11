"""Seat ranking: AC or PC seats ranked by one metric (engine RankingResult).

A ranking has one metric fixed by the card, so it has no lenses.
"""
from __future__ import annotations

from matbodh_dashboard.cards.families import FamilySpec
from matbodh_dashboard.cards.payload import Capabilities

SEAT_RANKING = FamilySpec(
    name="seat_ranking",
    scenario_kind="any",
    gender_differential=False,
    lenses=(),
    lens_sources={},
    default_lens="",
    capabilities=Capabilities(modes=["standalone", "compare", "trend"], transpose=False),
)
