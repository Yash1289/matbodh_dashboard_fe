"""Choose the engine coverage mode for a set of resolved rounds."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal

from matbodh_dashboard.compiler.rounds import ResolvedRound


def choose_coverage(
    rounds: Sequence[ResolvedRound],
    *,
    uses_seat_ids: bool,
    geographic: bool,
    version_mode: str,
) -> Literal["independent", "common"]:
    if uses_seat_ids:
        return "common"
    if version_mode == "matched" and geographic:
        return "common"
    if geographic and len({r.dataset.seat_ids for r in rounds}) > 1:
        return "common"
    return "independent"
