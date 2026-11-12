"""The typed relationship payload returned by /cards/run for relationship cards (spec section 6).

Every number is an engine value copied unchanged. A major-by-major cell the engine emitted no
row for carries no number and `absent="no_respondents"`. Mirrored by web/src/api/types.ts.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from matbodh_dashboard.cards.config import Family, RelationshipTable

Absent = Literal["no_respondents"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RelationshipGroup(_Strict):
    set_id: str
    dimensions: dict[str, str]


class RelationshipCell(_Strict):
    round: str
    group: RelationshipGroup
    origin: str
    destination: str
    origin_share: float | None
    destination_share: float | None
    joint_share: float | None
    size_of_impact_pp: float | None
    joint_count: int | None
    joint_mass: float | None
    origin_base: float | None
    destination_base: float | None
    paired_base: float | None
    paired_count: int | None
    absent: Absent | None


class RelationshipSummary(_Strict):
    round: str
    group: RelationshipGroup
    paired_count: int | None
    paired_base: float | None
    agreement_share: float | None
    agreement_mass: float | None
    composition_share: float | None
    agreement_size_of_impact_pp: float | None
    # With a focal party only (None otherwise):
    retention_share: float | None = None
    loss_share: float | None = None
    acquisition_share: float | None = None
    conversion_share: float | None = None
    retained_population_share: float | None = None
    lost_population_share: float | None = None
    gained_population_share: float | None = None
    neither_population_share: float | None = None
    net_flow_pp: float | None = None
    net_flow_size_of_impact_pp: float | None = None
    retention_size_of_impact_pp: float | None = None
    loss_size_of_impact_pp: float | None = None
    acquisition_size_of_impact_pp: float | None = None
    conversion_size_of_impact_pp: float | None = None
    retained_population_impact_pp: float | None = None
    gained_population_impact_pp: float | None = None
    lost_population_impact_pp: float | None = None
    neither_population_impact_pp: float | None = None
    focal_origin_base: float | None = None
    focal_destination_base: float | None = None
    retained_mass: float | None = None
    lost_mass: float | None = None
    gained_mass: float | None = None
    neither_mass: float | None = None


class RelationshipPayload(_Strict):
    kind: Literal["relationship"] = "relationship"
    family: Family
    card_id: str
    state: str
    rounds: dict
    origin: str
    destination: str
    focal_party: str | None
    weights: dict
    # Recalled statuses restored on an endpoint (widens the paired base); None when none are.
    answer_overrides: dict | None = None
    parties: list[str]  # the major parties in display order
    groups: list[RelationshipGroup]
    tables_available: list[RelationshipTable]
    default_table: RelationshipTable
    cells: list[RelationshipCell]
    summaries: list[RelationshipSummary]
    contract: dict
    not_asked: list[dict]
    unavailable: list[dict]
    rules_version: str | int
    engine_version: str
    metadata_revision: int
    alliance_epoch: int
