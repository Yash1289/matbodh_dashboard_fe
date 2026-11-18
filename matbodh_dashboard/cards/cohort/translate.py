"""Reshape an engine selection result into the cohort preview: the seat ids and nothing else."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel


class CohortPreview(BaseModel):
    kind: Literal["cohort_preview"] = "cohort_preview"
    seat_level: Literal["ac", "pc"]
    seat_ids: list[int]
    count: int


def translate_selection(result: Mapping[str, Any], job_config: Mapping[str, Any]) -> CohortPreview:
    source = job_config.get("ranking") or job_config["benchmark"]
    ids = sorted({int(row["seat_id"]) for row in result["selection_rows"]})
    return CohortPreview(seat_level=source["seat_level"], seat_ids=ids, count=len(ids))
