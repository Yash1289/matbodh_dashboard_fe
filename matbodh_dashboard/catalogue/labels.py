"""Survey round identity and short, unambiguous column labels.

Round order always comes from metadata (cycle year, then round number),
never from label text.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

_EXTRAPOLATED_SUFFIX = re.compile(r"\s*\(Extrapolated\)\s*$")
_ROUND_TOKEN = re.compile(r"\bR(\d+)\b")
_CYCLE_YEAR = re.compile(r"^(\d{4})\b\s*(.*)$")


def _split_cycle(cycle: str) -> tuple[int, str]:
    match = _CYCLE_YEAR.match(cycle.strip())
    if match is None:
        raise ValueError(f"cycle id must start with a four-digit year: {cycle!r}")
    return int(match.group(1)), match.group(2).strip()


@dataclass(frozen=True)
class RoundIdentity:
    state: str
    cycle: str
    series: str
    round: int | None
    base_name: str

    @property
    def sort_key(self) -> tuple[int, str, str, int]:
        year, rest = _split_cycle(self.cycle)
        return (year, rest, self.series, self.round or 0)


def parse_round(
    state: str, survey_name: str, cycle_id: str, round_number: int | None
) -> RoundIdentity:
    """Build a RoundIdentity from survey metadata."""
    base_name = _EXTRAPOLATED_SUFFIX.sub("", survey_name).strip()
    _split_cycle(cycle_id)  # validate the cycle id at parse time
    if not base_name.startswith(cycle_id):
        raise ValueError(
            f"survey name {survey_name!r} does not start with cycle id {cycle_id!r}"
        )
    remainder = base_name[len(cycle_id):]
    if remainder and not remainder[0].isspace():
        raise ValueError(
            f"survey name {survey_name!r} does not start with cycle id {cycle_id!r}"
        )
    remainder = _ROUND_TOKEN.sub(" ", remainder)
    series = " ".join(remainder.split())
    return RoundIdentity(
        state=state,
        cycle=cycle_id,
        series=series,
        round=round_number,
        base_name=base_name,
    )


def short_labels(rounds: Sequence[RoundIdentity]) -> dict[RoundIdentity, str]:
    """Label rounds with only the parts that differ across the set.

    Raises ValueError if two distinct rounds would get the same label.
    """
    unique = list(dict.fromkeys(rounds))
    multi_cycle = len({r.cycle for r in unique}) > 1
    multi_series = len({r.series for r in unique}) > 1

    cycles_per_year: dict[int, set[str]] = {}
    for r in unique:
        cycles_per_year.setdefault(_split_cycle(r.cycle)[0], set()).add(r.cycle)

    labels: dict[RoundIdentity, str] = {}
    for r in unique:
        parts: list[str] = []
        if multi_cycle:
            year, rest = _split_cycle(r.cycle)
            parts.append(f"{year % 100:02d}")
            if len(cycles_per_year[year]) > 1 and rest:
                parts.append(rest)  # same year, different cycle suffix
        if multi_cycle or multi_series:
            if r.series:
                parts.append(r.series)
        if r.round is not None:
            parts.append(f"R{r.round}")
        labels[r] = " ".join(parts)

    seen: dict[str, RoundIdentity] = {}
    for r, label in labels.items():
        if label in seen:
            raise ValueError(
                f"ambiguous round label {label!r} for {seen[label]} and {r}"
            )
        seen[label] = r
    return labels


def series_groups(
    rounds: Sequence[RoundIdentity],
) -> list[tuple[str, list[RoundIdentity]]]:
    """Group rounds by (cycle, series), ordered by metadata sort key."""
    grouped: dict[tuple[str, str], list[RoundIdentity]] = {}
    for r in sorted(dict.fromkeys(rounds), key=lambda x: x.sort_key):
        grouped.setdefault((r.cycle, r.series), []).append(r)
    return [(f"{cycle} · {series}", members) for (cycle, series), members in grouped.items()]
