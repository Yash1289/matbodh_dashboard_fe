"""Distribution: party scenarios over `rows` (engine AnalysisResult)."""
from __future__ import annotations

from matbodh_dashboard.cards.families import FamilySpec, LensSource
from matbodh_dashboard.cards.payload import Capabilities, LensDef

_PARTY = ("party",)


def _source(field: str, delta_field: str | None = None) -> LensSource:
    return LensSource("rows", field, _PARTY,
                      "support_share" if delta_field else None, delta_field)


DISTRIBUTION = FamilySpec(
    name="distribution",
    scenario_kind="party",
    gender_differential=False,
    lenses=(
        LensDef(id="support_share", label="Support %", unit="percentage", has_delta=True),
        LensDef(id="composition_share", label="Population share %", unit="percentage"),
        LensDef(id="contribution_share", label="Contribution %", unit="percentage"),
        LensDef(id="scenario_composition_share", label="Scenario share %", unit="percentage"),
        LensDef(id="joint_share", label="Joint %", unit="percentage"),
        LensDef(id="size_of_impact_pp", label="Impact", unit="percentage_points",
                has_delta=True),
    ),
    lens_sources={
        "support_share": _source("support_share", "percentage_point_difference"),
        "composition_share": _source("composition_share"),
        "contribution_share": _source("contribution_share"),
        "scenario_composition_share": _source("scenario_composition_share"),
        "joint_share": _source("joint_share"),
        "size_of_impact_pp": _source("size_of_impact_pp", "size_of_impact_pp"),
    },
    default_lens="support_share",
    capabilities=Capabilities(modes=["standalone", "compare", "trend"]),
)
