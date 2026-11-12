"""Relationship: two party questions of one survey row (engine RelationshipResult).

The card's table chooser picks Flow summary or Matrix, so the family has no lenses.
"""
from __future__ import annotations

from matbodh_dashboard.cards.families import FamilySpec
from matbodh_dashboard.cards.payload import Capabilities

RELATIONSHIP = FamilySpec(
    name="relationship",
    scenario_kind="party",
    gender_differential=False,
    lenses=(),
    lens_sources={},
    default_lens="",
    capabilities=Capabilities(modes=["standalone", "trend"], transpose=False),
)
