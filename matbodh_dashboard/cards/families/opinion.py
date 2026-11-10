"""Opinion scorecard: opinion scenarios over `scores`, plus per-option shares from `rows`."""
from __future__ import annotations

from matbodh_dashboard.cards.families import FamilySpec, LensSource
from matbodh_dashboard.cards.payload import Capabilities, LensDef


def _score(field: str, measure: str, delta_field: str) -> LensSource:
    return LensSource("scores", field, None, measure, delta_field)  # type: ignore[arg-type]


OPINION = FamilySpec(
    name="opinion",
    scenario_kind="opinion",
    gender_differential=False,
    lenses=(
        LensDef(id="net_score", label="Net score", unit="percentage_points", has_delta=True),
        LensDef(id="positive_share", label="Positive %", unit="percentage", has_delta=True),
        LensDef(id="negative_share", label="Negative %", unit="percentage", has_delta=True),
        LensDef(id="net_size_of_impact_pp", label="Net impact pp", unit="percentage_points",
                has_delta=True),
        LensDef(id="positive_size_of_impact_pp", label="Positive impact pp",
                unit="percentage_points", has_delta=True),
        LensDef(id="negative_size_of_impact_pp", label="Negative impact pp",
                unit="percentage_points", has_delta=True),
        LensDef(id="option_support_share", label="Answer distribution", unit="percentage"),
    ),
    lens_sources={
        "net_score": _score("net_score", "net_score", "percentage_point_difference"),
        "positive_share": _score("positive_share", "positive_share",
                                 "percentage_point_difference"),
        "negative_share": _score("negative_share", "negative_share",
                                 "percentage_point_difference"),
        "net_size_of_impact_pp": _score("net_size_of_impact_pp", "net_score",
                                        "size_of_impact_pp"),
        "positive_size_of_impact_pp": _score("positive_size_of_impact_pp", "positive_share",
                                             "size_of_impact_pp"),
        "negative_size_of_impact_pp": _score("negative_size_of_impact_pp", "negative_share",
                                             "size_of_impact_pp"),
        "option_support_share": LensSource("rows", "support_share", ("ordinal", "boolean")),
    },
    default_lens="net_score",
    capabilities=Capabilities(modes=["standalone", "compare", "trend"]),
)
