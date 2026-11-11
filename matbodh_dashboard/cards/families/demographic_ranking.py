"""Demographic ranking: groups of one profiling field ranked inside a partition."""
from __future__ import annotations

from matbodh_dashboard.cards.families import FamilySpec
from matbodh_dashboard.cards.payload import Capabilities

DEMOGRAPHIC_RANKING = FamilySpec(
    name="demographic_ranking",
    scenario_kind="any",
    gender_differential=False,
    lenses=(),
    lens_sources={},
    default_lens="",
    capabilities=Capabilities(modes=["standalone", "compare", "trend"], transpose=False),
)
