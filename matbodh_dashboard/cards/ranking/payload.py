"""The typed ranking payload returned by /cards/run for ranking cards (spec section 6).

All numbers are engine values copied unchanged. Mirrored by web/src/api/types.ts.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from matbodh_dashboard.cards.config import Family, Mode

AbsentReason = Literal["outside_top_k", "not_ranked", "round_failed"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RankedEntity(_Strict):
    key: str
    labels: dict[str, str | None]


class RankedGroup(_Strict):
    key: str
    partition: dict[str, str | None]
    # Entity keys in display order: the anchor round's rank, then the engine's row order.
    entities: list[str]
    eligible_count: dict[str, int | None]  # by observation id (seat ranking only)


class RankedValue(_Strict):
    entity: str
    group: str
    round: str
    rank: int | None
    value: float | None
    target_value: float | None
    reference_value: float | None
    target_base: float | None
    reference_base: float | None
    weighted_denominator: float | None
    unweighted_base: float | None
    status: str
    flags: list[str]


class AbsentSlot(_Strict):
    entity: str
    group: str
    round: str
    reason: AbsentReason


class RankedPayload(_Strict):
    kind: Literal["ranked"] = "ranked"
    family: Family
    card_id: str
    mode: Mode
    state: str
    rounds: dict
    entity_kind: Literal["seat", "demographic"]
    level: str
    partition_by: list[str]
    top_k: int | None
    direction: str | None
    unit: str | None
    groups: list[RankedGroup]
    entities: list[RankedEntity]
    ranks: list[RankedValue]
    absent: list[AbsentSlot]
    unavailable: list[dict]
    not_asked: list[dict]
    coverage: list[dict]
    contracts: dict[str, dict]
    rules_version: str | int
    engine_version: str
    metadata_revision: int
    alliance_epoch: int
