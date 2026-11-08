"""Dashboard card templates: what each card computes."""
from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Requirements(_Strict):
    min_level: Literal["state", "ac"]
    focus_party: bool = False


class CardTemplate(_Strict):
    id: str
    section: str
    title: str
    operation: Literal["scoreboard", "distribution", "opinion"]
    questions: list[str]
    measures: list[str]
    slices: list[str] = []
    cell: list[str]
    density: Literal["compact", "standard", "detailed"]
    requires: Requirements


def load_templates(path: Path) -> dict[str, CardTemplate]:
    """Load a templates YAML file (a list under `templates:`) keyed by id."""
    with Path(path).open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict) or "templates" not in data:
        raise ValueError(f"{path}: expected a top-level 'templates' list")
    result: dict[str, CardTemplate] = {}
    for raw in data["templates"]:
        template = CardTemplate.model_validate(raw)
        if template.id in result:
            raise ValueError(f"{path}: duplicate template id {template.id!r}")
        result[template.id] = template
    return result
