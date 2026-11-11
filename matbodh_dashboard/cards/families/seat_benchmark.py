"""Seat benchmark: a survey against nothing, another survey or an actual election (engine BenchmarkResult).

The card's table chooser picks one of the engine's tables, so the family has no lenses.
"""
from __future__ import annotations

from matbodh_dashboard.cards.families import FamilySpec
from matbodh_dashboard.cards.payload import Capabilities

SEAT_BENCHMARK = FamilySpec(
    name="seat_benchmark",
    scenario_kind="party",
    gender_differential=False,
    lenses=(),
    lens_sources={},
    default_lens="",
    capabilities=Capabilities(modes=["standalone"], transpose=False),
)
