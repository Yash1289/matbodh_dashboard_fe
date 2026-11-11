"""Family specs: static lens tables and capabilities for each engine result family.

A new family adds one module here and one frontend folder; it never edits the shell.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from matbodh_dashboard.cards.config import Family
from matbodh_dashboard.cards.payload import Capabilities, FamilyMeta, LensDef


@dataclass(frozen=True)
class LensSource:
    """Where a lens reads its engine value, and which comparison row gives its delta."""

    array: Literal["rows", "scores", "gender_differentials"]
    field: str
    domain: tuple[str, ...] | None = None  # outcome_domain filter on `rows`
    delta_measure: str | None = None
    delta_field: Literal["percentage_point_difference", "size_of_impact_pp"] | None = None


@dataclass(frozen=True)
class FamilySpec:
    name: Family
    scenario_kind: Literal["party", "opinion", "any"]
    gender_differential: bool
    lenses: tuple[LensDef, ...]
    lens_sources: Mapping[str, LensSource]
    default_lens: str
    capabilities: Capabilities


def family_meta(spec: FamilySpec) -> FamilyMeta:
    """All of the family's lenses, before any filtering by returned data."""
    return FamilyMeta(family=spec.name, lenses=list(spec.lenses),
                      default_lens=spec.default_lens, capabilities=spec.capabilities)


def get_family(name: str) -> FamilySpec:
    return FAMILIES[name]


from matbodh_dashboard.cards.families.distribution import DISTRIBUTION  # noqa: E402
from matbodh_dashboard.cards.families.gender_differential import GENDER_DIFFERENTIAL  # noqa: E402
from matbodh_dashboard.cards.families.demographic_ranking import DEMOGRAPHIC_RANKING  # noqa: E402
from matbodh_dashboard.cards.families.opinion import OPINION  # noqa: E402
from matbodh_dashboard.cards.families.seat_benchmark import SEAT_BENCHMARK  # noqa: E402
from matbodh_dashboard.cards.families.seat_ranking import SEAT_RANKING  # noqa: E402

FAMILIES: dict[str, FamilySpec] = {
    spec.name: spec
    for spec in (DISTRIBUTION, OPINION, GENDER_DIFFERENTIAL, SEAT_RANKING, DEMOGRAPHIC_RANKING,
                 SEAT_BENCHMARK)
}
