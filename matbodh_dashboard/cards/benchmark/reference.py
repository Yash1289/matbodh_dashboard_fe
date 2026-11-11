"""What a benchmark card compares the anchor survey against (spec section 5).

It is chosen on the card at run time, never in the card config, so it is part of the request
and the engine fingerprint but the card's `view` is not.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

from matbodh_dashboard.cards.benchmark.parties import ElectionType


class BenchmarkReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["none", "compare", "election"]
    year: int | None = None
    election_type: ElectionType | None = None

    @model_validator(mode="after")
    def _check(self) -> "BenchmarkReference":
        has_election = self.year is not None or self.election_type is not None
        if self.kind == "election" and (self.year is None or self.election_type is None):
            raise ValueError("an election reference needs year and election_type")
        if self.kind != "election" and has_election:
            raise ValueError("year and election_type apply to an election reference only")
        return self
