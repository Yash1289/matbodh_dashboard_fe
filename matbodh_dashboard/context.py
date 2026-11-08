"""Global dashboard selection: per-state context and the multi-state wrapper."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class StateContext(BaseModel):
    """Selection for one state. ``rounds`` are base names (no Extrapolated suffix)."""

    model_config = ConfigDict(extra="forbid")

    state: str
    level: Literal["ac", "pc", "zone", "state"]
    rounds: list[str]
    compare_round: str | None = None
    anchor_round: str | None = None
    version_mode: Literal["extrapolated", "matched"] = "extrapolated"
    geo_scope: Literal["state", "zone", "district", "seat"] = "state"


class Context(BaseModel):
    model_config = ConfigDict(extra="forbid")

    states: list[StateContext]
    focus_party: str | None = None
