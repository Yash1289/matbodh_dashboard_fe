"""Request and response shapes for the dashboard HTTP API."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator

from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
from matbodh_dashboard.cards.cohort.compile import SelectionPredicate
from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.configure.limits import check_inline_limits
from matbodh_dashboard.context import StateContext

class _CardTarget(BaseModel):
    """Which card a request is about: a library card by id, or a full config sent inline."""

    model_config = ConfigDict(extra="forbid")

    card_id: str | None = None
    card: CardConfig | None = None

    @model_validator(mode="after")
    def _exactly_one(self):
        if (self.card_id is None) == (self.card is None):
            raise ValueError("give exactly one of card_id or card")
        if self.card is not None:
            check_inline_limits(self.card)
        return self


class CardRequest(_CardTarget):
    """Body of /cards/plan and /cards/run."""

    context: StateContext
    # Benchmark cards only: what the anchor survey is compared with. Other cards ignore it.
    reference: BenchmarkReference | None = None


class PreviewRequest(_CardTarget):
    """Body of /cohorts/preview: the card whose seats are selected and what to select."""

    context: StateContext
    predicate: SelectionPredicate
    reference: BenchmarkReference | None = None


class ValidateRequest(BaseModel):
    """Body of /cards/validate: a draft card (checked, never run) and the context it would run in."""

    model_config = ConfigDict(extra="forbid")

    card: dict
    context: StateContext


class OptionsRequest(BaseModel):
    """Body of /configure/options: which list, its parameters, the draft card and its context."""

    model_config = ConfigDict(extra="forbid")

    source: str
    params: dict[str, str | int | bool] = {}
    card: dict = {}
    context: StateContext


class ValuesRequest(BaseModel):
    """Body of /configure/values: the field to list, optionally the scenario and pipe-round window."""

    model_config = ConfigDict(extra="forbid")

    field: str
    scenario: str | None = None
    context: StateContext
    pipe_rounds: int | None = Field(default=None, ge=1)


class StatesResponse(BaseModel):
    states: list[str]


class RunStarted(BaseModel):
    run_id: str


class MetadataRefreshed(BaseModel):
    revision: int
    alliance_epoch: int
