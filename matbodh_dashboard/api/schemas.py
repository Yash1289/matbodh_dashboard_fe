"""Request and response shapes for the dashboard HTTP API."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
from matbodh_dashboard.cards.cohort.compile import SelectionPredicate
from matbodh_dashboard.context import StateContext


class CardRequest(BaseModel):
    """Body of /cards/plan and /cards/run."""

    model_config = ConfigDict(extra="forbid")

    card_id: str
    context: StateContext
    # Benchmark cards only: what the anchor survey is compared with. Other cards ignore it.
    reference: BenchmarkReference | None = None


class PreviewRequest(BaseModel):
    """Body of /cohorts/preview: the card whose seats are selected and what to select."""

    model_config = ConfigDict(extra="forbid")

    card_id: str
    context: StateContext
    predicate: SelectionPredicate
    reference: BenchmarkReference | None = None


class StatesResponse(BaseModel):
    states: list[str]


class RunStarted(BaseModel):
    run_id: str


class MetadataRefreshed(BaseModel):
    revision: int
    alliance_epoch: int
