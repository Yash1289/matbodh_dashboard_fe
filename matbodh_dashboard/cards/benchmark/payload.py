"""The typed benchmark payload returned by /cards/run for benchmark cards (spec section 7).

Every number is an engine value copied unchanged. Where an endpoint's alliance mapping lacks
a party, that side's values are None with a reason; the engine's 0 for it is never shown.
Mirrored by web/src/api/types.ts.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from matbodh_dashboard.cards.config import BenchmarkTable, Family

Side = Literal["target", "reference"]
AbsentReason = Literal["not_in_endpoint_mapping"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BenchmarkGroup(_Strict):
    set_id: str
    dimensions: dict[str, str]


class SummaryRow(_Strict):
    endpoint: Side
    group: BenchmarkGroup
    party: str
    eligible_seats: int
    seats: int | None
    seat_share: float | None
    vote_share: float | None
    support_mass: float | None
    support_base: float | None
    absent: AbsentReason | None


class ComparisonRow(_Strict):
    group: BenchmarkGroup
    party: str
    eligible_seats: int
    target_vote_share: float | None
    reference_vote_share: float | None
    vote_share_delta_pp: float | None
    target_seats: int | None
    reference_seats: int | None
    seat_delta: int | None
    seat_share_delta_pp: float | None
    absent_sides: list[Side]


class BucketRow(_Strict):
    endpoint: Side
    group: BenchmarkGroup
    bucket: str
    seats: int
    eligible_seats: int


class FlipRow(_Strict):
    group: BenchmarkGroup
    bucket: str
    seats: int
    eligible_seats: int


class BenchmarkPayload(_Strict):
    kind: Literal["benchmark"] = "benchmark"
    family: Family
    card_id: str
    state: str
    rounds: dict
    reference: dict  # {"kind": "none" | "compare" | "election", "label": str | None}
    focal_party: str | None
    parties: list[str]  # the major parties; Other is separate
    other_label: str
    endpoint_parties: dict[str, list[str]]
    tables_available: list[BenchmarkTable]
    default_table: BenchmarkTable
    comparisons: list[ComparisonRow]
    summaries: list[SummaryRow]
    margin_buckets: list[BucketRow]
    flips: list[FlipRow]
    contract: dict
    unavailable: list[dict]
    rules_version: str | int
    engine_version: str
    metadata_revision: int
    alliance_epoch: int
