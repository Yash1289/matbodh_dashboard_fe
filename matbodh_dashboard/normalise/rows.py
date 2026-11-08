"""Uniform rows from MatBodh engine results (dicts from dataclasses.asdict).

The engine owns every number: values are copied verbatim, never derived. A
missing value stays None and is flagged; it is never coerced to zero.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

Dims = tuple[tuple[str, str | None, bool], ...]

_NO_ELIGIBLE = "no_eligible_result"
# Summaries of a paired benchmark: counted on seats eligible in both endpoints.
COMMON_SEATS = "common_seats"
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
    scenario: str | None = None
    grouping_set_id: str | None = None


def _dims(raw: Mapping | str | None) -> Dims:
    """Accept the analysis shape {name: {value, is_subtotal}} or the benchmark
    shape (JSON string or dict) {name: value}."""
    if isinstance(raw, str):
        raw = json.loads(raw)
    out = []
    for name, d in (raw or {}).items():
        if isinstance(d, Mapping) and "value" in d:
            out.append((name, d.get("value"), bool(d.get("is_subtotal", False))))
        else:
            out.append((name, d, False))
    return tuple(out)


def _series(r: Mapping) -> str:
    """party_id for party domains; option_id once the engine popped party_id."""
    key = r.get("party_id") or r.get("option_id")
    if key is None:
        raise ValueError("Engine row has neither party_id nor option_id")
    return str(key)


def _row(state, obs_id, measure, series, raw_dims, value, unit, base=None, flags=(),
         scenario=None, grouping_set_id=None):
    flag_set = set(flags)
    if value is None:
        flag_set.add("null_value")
    return NormalRow(state, obs_id, measure, str(series), _dims(raw_dims), value, unit,
                     base, frozenset(flag_set), scenario, grouping_set_id)


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
        out.append(_row(state, r["observation_id"], "support_share", _series(r),
                        r.get("dimensions"), r.get("support_share"), "pct",
                        r.get("weighted_denominator"), scenario=r.get("scenario_id"),
                        grouping_set_id=r.get("grouping_set_id")))

    for c in result.get("comparisons") or ():
        measure = _DELTA_MEASURES.get(c.get("measure", "support_share"))
        if measure is None:
            raise ValueError(f"Unsupported comparison measure: {c.get('measure')!r}")
        obs_id, scenario = c["target"][0], c["target"][1]
        if _dead(status, obs_id, scenario):
            continue
        # Score comparisons (net/positive/negative) carry no party or option;
        # their series is the target scenario.
        series = c.get("party_id") or c.get("option_id") or scenario
        flags = ("not_covered",) if c.get("coverage_status", "aligned") != "aligned" else ()
        out.append(_row(state, obs_id, measure, series, c.get("dimensions"),
                        c.get("percentage_point_difference"), "pp", flags=flags,
                        scenario=scenario, grouping_set_id=c.get("grouping_set_id")))

    for s in result.get("scores") or ():
        if _dead(status, s["observation_id"], s.get("scenario_id")):
            continue
        base = s.get("weighted_denominator")
        no_base = not base or s.get("coverage_status", "available") != "available"
        for measure, field, unit in _SCORE_FIELDS:
            out.append(_row(state, s["observation_id"], measure, s["scenario_id"],
                            s.get("dimensions"), s.get(field), unit, base,
                            ("no_base",) if no_base else (), scenario=s["scenario_id"],
                            grouping_set_id=s.get("grouping_set_id")))

    for g in result.get("gender_differentials") or ():
        if _dead(status, g["observation_id"], g.get("scenario_id")):
            continue
        unavailable = g.get("coverage_status") != "available"
        for measure, field, unit in _GENDER_FIELDS:
            out.append(_row(state, g["observation_id"], measure, _series(g),
                            g.get("dimensions"), None if unavailable else g.get(field),
                            unit, None, ("no_base",) if unavailable else (),
                            scenario=g.get("scenario_id"),
                            grouping_set_id=g.get("grouping_set_id")))
    return out


def from_benchmark(result: dict, state: str, level: Literal["ac", "pc"]) -> list[NormalRow]:
    """Summaries keep their own endpoint as obs_id; comparison rows use the
    benchmark's target endpoint id read from ``result["contract"]["target"]``.
    Grouping identity is kept in ``grouping_set_id`` and ``dims``."""
    out: list[NormalRow] = []
    paired = bool((result.get("contract") or {}).get("reference"))
    seat_flags = (COMMON_SEATS,) if paired else ()
    for s in result.get("summaries") or ():
        gid, dimensions = s.get("grouping_set_id"), s.get("dimensions")
        out.append(_row(state, s["endpoint"], f"seats_{level}", s["party_id"], dimensions,
                        s.get("seat_count"), "seats", s.get("eligible_seat_count"),
                        seat_flags, grouping_set_id=gid))
        out.append(_row(state, s["endpoint"], "vote_share_bench", s["party_id"], dimensions,
                        s.get("vote_share"), "pct", s.get("support_base"),
                        grouping_set_id=gid))

    comparisons = result.get("comparisons") or ()
    if comparisons:
        target = (result.get("contract") or {}).get("target")
        if not target:
            raise ValueError("Benchmark contract has no target endpoint id")
        for c in comparisons:
            out.append(_row(state, target, f"delta_seats_{level}", c["party_id"],
                            c.get("dimensions"), c.get("seat_count_delta"), "seats",
                            c.get("eligible_seat_count"),
                            grouping_set_id=c.get("grouping_set_id")))
    return out
