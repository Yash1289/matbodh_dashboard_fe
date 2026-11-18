"""The cohort value sent inside the dashboard context. The client supplies it, so it is validated."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_COHORT_SEATS = 2000


class CohortRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seat_level: Literal["ac", "pc"]
    seat_ids: list[int]
    label: str = Field(min_length=1, max_length=120)
    created_at: datetime

    @field_validator("seat_ids", mode="before")
    @classmethod
    def _clean_ids(cls, value: Any) -> list[int]:
        if not isinstance(value, list):
            raise ValueError("seat_ids must be a list")
        # bool is an int subclass and "12" would coerce; neither is a seat id.
        if any(type(v) is not int or v <= 0 for v in value):
            raise ValueError("seat_ids must be positive integers")
        ids = sorted(set(value))
        if not ids:
            raise ValueError("seat_ids must not be empty")
        if len(ids) > MAX_COHORT_SEATS:
            raise ValueError(f"seat_ids holds at most {MAX_COHORT_SEATS} seats")
        return ids

    @field_validator("label", mode="before")
    @classmethod
    def _strip_label(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value
