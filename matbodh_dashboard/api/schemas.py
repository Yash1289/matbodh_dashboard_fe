"""Request and response shapes for the dashboard HTTP API."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from matbodh_dashboard.context import StateContext


class CardRequest(BaseModel):
    """Body of /cards/plan and /cards/run."""

    model_config = ConfigDict(extra="forbid")

    card_id: str
    context: StateContext


class StatesResponse(BaseModel):
    states: list[str]


class RunStarted(BaseModel):
    run_id: str


class MetadataRefreshed(BaseModel):
    revision: int
    alliance_epoch: int
