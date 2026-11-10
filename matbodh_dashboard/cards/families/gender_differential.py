"""Gender differential: party scenarios over `gender_differentials`. No engine comparison."""
from __future__ import annotations

from matbodh_dashboard.cards.families import FamilySpec, LensSource
from matbodh_dashboard.cards.payload import Capabilities, LensDef


def _source(field: str) -> LensSource:
    return LensSource("gender_differentials", field)


GENDER_DIFFERENTIAL = FamilySpec(
    name="gender_differential",
    scenario_kind="party",
    gender_differential=True,
    lenses=(
        LensDef(id="gender_differential_pp", label="Differential pp",
                unit="percentage_points"),
        LensDef(id="female_support_share", label="Female %", unit="percentage"),
        LensDef(id="male_support_share", label="Male %", unit="percentage"),
        LensDef(id="size_of_impact_pp", label="Impact pp", unit="percentage_points"),
    ),
    lens_sources={
        "gender_differential_pp": _source("gender_differential_pp"),
        "female_support_share": _source("female_support_share"),
        "male_support_share": _source("male_support_share"),
        "size_of_impact_pp": _source("size_of_impact_pp"),
    },
    default_lens="gender_differential_pp",
    capabilities=Capabilities(modes=["standalone", "trend"]),
)
