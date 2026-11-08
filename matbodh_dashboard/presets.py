"""Method presets: the admin-owned calculation policy."""
from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WeightSpec(_Strict):
    mode: str
    invalid: str
    zero: str


class OpinionWeightSpec(_Strict):
    source: Literal["base", "scenario"]
    scenario: str | None = None
    mode: str | None = None


class GenderSpec(_Strict):
    field: str
    female: list[str]
    male: list[str]


class MethodPreset(_Strict):
    id: str
    version: int
    weights: WeightSpec
    answers_excluded: list[str]
    strip_whitespace: bool
    keep: list[str]
    other_label: str
    passthrough: bool
    opinion_weights: OpinionWeightSpec
    caste_threshold_pct: float
    gender: GenderSpec
    competition_excluded: list[str]
    alliance_reporting_type: str


def load_preset(path: Path) -> MethodPreset:
    """Load and validate a preset YAML file; unknown keys are rejected."""
    with Path(path).open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    return MethodPreset.model_validate(data)
