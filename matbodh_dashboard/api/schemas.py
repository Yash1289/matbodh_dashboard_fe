"""Request and response shapes for the dashboard HTTP API."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, model_validator

from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
from matbodh_dashboard.cards.cohort.compile import SelectionPredicate
from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.context import StateContext

# Limits on a card sent from the browser (spec 8.1): a trust boundary, so bounded.
MAX_TITLE, MAX_SCENARIOS, MAX_CUTS, MAX_FILTERS, MAX_FILTER_VALUES = 200, 12, 8, 8, 200


def check_inline_limits(card: CardConfig) -> None:
    """Raise ValueError naming the limit a card sent from the browser exceeds."""
    if len(card.title) > MAX_TITLE:
        raise ValueError(f"title is at most {MAX_TITLE} characters")
    if len(card.scenarios) > MAX_SCENARIOS:
        raise ValueError(f"a card has at most {MAX_SCENARIOS} scenarios")
    if len(card.cuts) > MAX_CUTS:
        raise ValueError(f"a card has at most {MAX_CUTS} cuts")
    for specs in (card.filters, card.rank.filters if card.rank is not None else []):
        if len(specs) > MAX_FILTERS:
            raise ValueError(f"a card has at most {MAX_FILTERS} filters")
        if any(len(f.values) > MAX_FILTER_VALUES for f in specs):
            raise ValueError(f"a filter has at most {MAX_FILTER_VALUES} values")


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


class StatesResponse(BaseModel):
    states: list[str]


class RunStarted(BaseModel):
    run_id: str


class MetadataRefreshed(BaseModel):
    revision: int
    alliance_epoch: int
