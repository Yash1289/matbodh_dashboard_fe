"""Uniform rows from MatBodh engine results (dicts from dataclasses.asdict).

The engine owns every number: values are copied verbatim, never derived. A
missing value stays None and is flagged; it is never coerced to zero.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

Dims = tuple[tuple[str, str | None, bool], ...]

_NO_ELIGIBLE = "no_eligible_result"
_DELTA_MEASURES = {
    "support_share": "delta_support",
    "net_score": "delta_net_score",
    "positive_share": "delta_positive_share",
    "negative_share": "delta_negative_share",
}
_SCORE_FIELDS = (
    ("net_score", "net_score", "pp"),
    ("positive_share", "positive_share", "pct"),
    ("negative_share", "negative_share", "pct"),
)
_GENDER_FIELDS = (
    ("gender_gap", "gender_differential_pp", "pp"),
    ("female_share", "female_support_share", "pct"),
    ("male_share", "male_support_share", "pct"),
)


@dataclass(frozen=True)
class NormalRow:
    state: str
    obs_id: str | None
    measure: str
    series: str
    dims: Dims
    value: float | None
    unit: Literal["pct", "pp", "seats"]
    base: float | None
    flags: frozenset[str]


def _dims(raw: Mapping | None) -> Dims:
    return tuple(
        (name, d.get("value"), bool(d.get("is_subtotal", False)))
        for name, d in (raw or {}).items()
    )


def _row(state, obs_id, measure, series, raw_dims, value, unit, base=None, flags=()):
    flag_set = set(flags)
    if value is None:
        flag_set.add("null_value")
    return NormalRow(state, obs_id, measure, str(series), _dims(raw_dims), value, unit,
                     base, frozenset(flag_set))


def _dead(status: Mapping, obs_id: str | None, scenario: str | None) -> bool:
    if scenario is not None:
        return status.get(f"{obs_id}:{scenario}") == _NO_ELIGIBLE
    keys = [v for k, v in status.items() if k.split(":", 1)[0] == obs_id]
    return bool(keys) and all(v == _NO_ELIGIBLE for v in keys)


def from_analysis(result: dict, state: str) -> list[NormalRow]:
    status = result.get("context_status") or {}
    out: list[NormalRow] = []

    for r in result.get("rows") or ():
        if _dead(status, r["observation_id"], r.get("scenario_id")):
            continue
        out.append(_row(state, r["observation_id"], "support_share", r["party_id"],
                        r.get("dimensions"), r.get("support_share"), "pct",
                        r.get("weighted_denominator")))

    for c in result.get("comparisons") or ():
        measure = _DELTA_MEASURES.get(c.get("measure", "support_share"))
        if measure is None:
            raise ValueError(f"Unsupported comparison measure: {c.get('measure')!r}")
        obs_id, scenario = c["target"][0], c["target"][1]
        if _dead(status, obs_id, scenario):
            continue
        series = c.get("party_id") or scenario
        out.append(_row(state, obs_id, measure, series, c.get("dimensions"),
                        c.get("percentage_point_difference"), "pp"))

    for s in result.get("scores") or ():
        if _dead(status, s["observation_id"], s.get("scenario_id")):
            continue
        for measure, field, unit in _SCORE_FIELDS:
            out.append(_row(state, s["observation_id"], measure, s["scenario_id"],
                            s.get("dimensions"), s.get(field), unit,
                            s.get("weighted_denominator")))

    for g in result.get("gender_differentials") or ():
        if _dead(status, g["observation_id"], g.get("scenario_id")):
            continue
        unavailable = g.get("coverage_status") != "available"
        for measure, field, unit in _GENDER_FIELDS:
            out.append(_row(state, g["observation_id"], measure, g["party_id"],
                            g.get("dimensions"), None if unavailable else g.get(field),
                            unit, None, ("no_base",) if unavailable else ()))
    return out


def from_benchmark(result: dict, state: str, level: Literal["ac", "pc"]) -> list[NormalRow]:
    """Summaries keep their own endpoint as obs_id; comparison rows use the
    benchmark's target endpoint id read from ``result["contract"]["target"]``."""
    out: list[NormalRow] = []
    for s in result.get("summaries") or ():
        base = s.get("eligible_seat_count")
        out.append(_row(state, s["endpoint"], f"seats_{level}", s["party_id"], None,
                        s.get("seat_count"), "seats", base))
        out.append(_row(state, s["endpoint"], "vote_share_bench", s["party_id"], None,
                        s.get("vote_share"), "pct", base))

    comparisons = result.get("comparisons") or ()
    if comparisons:
        target = (result.get("contract") or {}).get("target")
        if not target:
            raise ValueError("Benchmark contract has no target endpoint id")
        for c in comparisons:
            out.append(_row(state, target, f"delta_seats_{level}", c["party_id"], None,
                            c.get("seat_count_delta"), "seats", c.get("eligible_seat_count")))
    return out
