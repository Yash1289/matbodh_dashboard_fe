"""Seat names from the master (spec section 6.1).

Engine ranking rows carry only a seat number. Names are labels, not numbers, so they
are looked up as small metadata; a name the engine row itself carries always wins.
"""
from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any, Literal, Protocol

Level = Literal["ac", "pc"]


class SeatLabelProvider(Protocol):
    def labels(self, state: str, level: Level, seat_ids: Sequence[int]) -> dict[int, dict[str, str]]:
        """`{seat_id: {"name": ..., "zone": ...}}`; seats the master lacks are omitted."""


class MasterSeatLabels:
    """Reads names through a snapshot loader; cached per state, level and metadata revision.

    `snapshot(state, level, attributes)` returns an object whose `records` are mappings
    keyed by `ac_num` or `pc_num` (the engine's `MySQLAccess.seat_snapshot`).
    """

    def __init__(self, snapshot: Callable[[str, str, tuple[str, ...]], Any],
                 revision: Callable[[], int]) -> None:
        self._snapshot = snapshot
        self._revision = revision
        self._cache: dict[tuple[str, str, int], dict[int, dict[str, str]]] = {}

    def labels(self, state: str, level: Level, seat_ids: Sequence[int]) -> dict[int, dict[str, str]]:
        revision = self._revision()
        key = (state, level, revision)
        if key not in self._cache:
            self._cache = {k: v for k, v in self._cache.items() if k[2] == revision}
            self._cache[key] = self._load(state, level)
        table = self._cache[key]
        return {i: table[i] for i in seat_ids if i in table}

    def _load(self, state: str, level: Level) -> dict[int, dict[str, str]]:
        name = f"{level}_name"
        try:
            snapshot = self._snapshot(state, level, (name, "zone"))
        except ValueError:  # a seat without a zone must not cost every name
            snapshot = self._snapshot(state, level, (name,))
        table: dict[int, dict[str, str]] = {}
        for record in snapshot.records:
            labels = {"name": str(record[name])}
            if record.get("zone") is not None:
                labels["zone"] = str(record["zone"])
            table[record[f"{level}_num"]] = labels
        return table
