"""The typed card payload returned by /cards/run (spec section 6.3).

All numbers are engine values copied unchanged. Long format: the browser pivots
cells without arithmetic. Mirrored by web/src/api/types.ts.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from matbodh_dashboard.cards.config import Family, Mode

# Cell and delta status vocabulary. `aligned` from the engine maps to `available`.
STATUSES = ("available", "null_value", "missing_target", "missing_reference",
            "not_covered", "not_asked", "no_eligible_result")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LensDef(_Strict):
    id: str
    label: str
    unit: Literal["percentage", "percentage_points"]
    has_delta: bool = False


class Capabilities(_Strict):
    modes: list[Mode]
    transpose: bool = True
    sort: bool = True
    details: bool = True
    population: bool = False  # the family returns `populations`, so tables lead with a Pop % column


class FamilyMeta(_Strict):
    family: Family
    lenses: list[LensDef]
    default_lens: str
    capabilities: Capabilities


class Column(_Strict):
    key: str
    label: str
    scenario: str
    kind: Literal["party", "option", "scale"]
    colour: str | None = None
    lenses: list[str] | None = None  # lenses this column applies to; None = all


class RowDef(_Strict):
    key: str
    labels: dict[str, str | None]
    subtotal: list[str]


class CellValue(_Strict):
    row: str
    column: str
    round: str | None
    lens: str
    value: float | None
    status: str


class DeltaValue(_Strict):
    row: str
    column: str
    lens: str
    target: str
    reference: str
    value: float | None
    reference_value: float | None = None
    relative_change_pct: float | None = None
    status: str


class BaseDetail(_Strict):
    row: str
    column: str
    round: str | None
    fields: dict[str, Any]


class PopulationValue(_Strict):
    """A row's share of the whole population, from the anchor round (the engine's composition_share)."""
    row: str
    value: float | None
    status: str


class Cut(_Strict):
    id: str
    dimensions: list[str]
    rows: list[RowDef]
    cells: list[CellValue]
    deltas: list[DeltaValue]
    bases: list[BaseDetail]
    population: list[PopulationValue] = []


class GridPayload(_Strict):
    family: Family
    card_id: str
    mode: Mode
    state: str
    rounds: dict
    meta: FamilyMeta
    columns: list[Column]
    cuts: list[Cut]
    unavailable: list[dict]
    not_asked: list[dict]
    coverage: list[dict]
    provenance: dict
    hidden_count: int
    rules_version: str | int
    engine_version: str
    metadata_revision: int
    alliance_epoch: int
