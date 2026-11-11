"""Major parties and election choices for benchmark cards (spec sections 4.1 and 5).

The major parties are whatever the alliance table maps for an endpoint; nothing is
hardcoded. Lookups are small, read-only metadata, cached for the session per alliance epoch.
"""
from __future__ import annotations

import threading
from collections.abc import Callable
from contextlib import AbstractContextManager
from pathlib import Path
from typing import Any, Literal, Protocol

import yaml
from pydantic import BaseModel, ConfigDict

ElectionType = Literal["LS", "VS"]


class MajorPartyProvider(Protocol):
    def identities(self, state: str, reporting_type: str, *, year: int | None = None,
                   election_type: ElectionType | None = None) -> frozenset[str]:
        """Canonical identities in the alliance mapping for a survey (no year) or an actual election.

        Raises ValueError with the engine's message when no single state-level context exists.
        """


class AllianceMajorParties:
    """`session_factory()` is a context manager yielding an engine `AllianceSession`
    (a short-lived read-only connection); `epoch()` is the cache's alliance epoch."""

    def __init__(self, session_factory: Callable[[], AbstractContextManager[Any]],
                 epoch: Callable[[], int]) -> None:
        self._factory = session_factory
        self._epoch = epoch
        self._cache: dict[tuple, frozenset[str]] = {}
        self._lock = threading.Lock()

    def identities(self, state: str, reporting_type: str, *, year: int | None = None,
                   election_type: ElectionType | None = None) -> frozenset[str]:
        epoch = self._epoch()
        key = (state, reporting_type, year, election_type, epoch)
        with self._lock:
            if key not in self._cache:
                self._cache = {k: v for k, v in self._cache.items() if k[4] == epoch}
                with self._factory() as session:
                    identity = session.identity(state, reporting_type=reporting_type, year=year,
                                                election_type=election_type)
                self._cache[key] = frozenset(identity.mapping.values())
            return self._cache[key]


class ElectionOption(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    year: int
    election_type: ElectionType
    label: str


class _RawElection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    year: int
    election_type: ElectionType


def load_elections(path: Path) -> dict[str, list[ElectionOption]]:
    """`{state: [{year, election_type}]}` from YAML; the picker lists exactly these."""
    with Path(path).open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected a mapping of state to elections")
    out: dict[str, list[ElectionOption]] = {}
    for state, items in data.items():
        options = [_RawElection.model_validate(i) for i in items]
        keys = [(o.year, o.election_type) for o in options]
        if len(set(keys)) != len(keys):
            raise ValueError(f"{path}: duplicate election for {state!r}")
        out[state] = [ElectionOption(year=o.year, election_type=o.election_type,
                                     label=f"{o.year} {o.election_type}") for o in options]
    return out
