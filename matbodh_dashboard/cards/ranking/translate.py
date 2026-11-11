"""Engine ranking results to a RankedPayload (spec sections 5.2, 5.3 and 6).

The engine owns every rank and number: values are copied unchanged. A round's result
is keyed by observation id; the anchor round decides the rows, later rounds are looked
up for the same (entity, group) pairs.
"""
from __future__ import annotations

from collections.abc import Callable, Collection, Mapping
from dataclasses import dataclass

from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.ranking.payload import (
    AbsentSlot, RankedEntity, RankedGroup, RankedPayload, RankedValue)
from matbodh_dashboard.cards.translate import TranslateContext, row_key

_OK = {None, "available", "aligned"}


@dataclass(frozen=True)
class _Row:
    entity: str
    labels: dict[str, str | None]
    partition: dict[str, str | None]
    value: dict  # RankedValue fields apart from entity, group and round
    eligible: int | None


@dataclass(frozen=True)
class _Read:
    rows: list[_Row]
    direction: str | None
    unit: str | None


def _status(row: dict) -> str:
    raw = row.get("metric_status")
    if row.get("metric_value") is None:
        return "null_value" if raw in _OK else str(raw)
    return "available" if raw in _OK else str(raw)


def _value_fields(row: dict) -> dict:
    return {
        "rank": row.get("rank"), "value": row.get("metric_value"),
        "target_value": row.get("target_value"), "reference_value": row.get("reference_value"),
        "target_base": row.get("target_base"), "reference_base": row.get("reference_base"),
        "weighted_denominator": row.get("weighted_denominator"),
        "unweighted_base": row.get("unweighted_base"),
        "status": _status(row), "flags": [],
    }


def _read_seat(card: CardConfig, result: dict) -> _Read:
    rows = [
        _Row(entity=str(r["seat_id"]), labels={"seat_id": str(r["seat_id"])},
             partition=dict(r.get("partition") or {}), value=_value_fields(r),
             eligible=r.get("eligible_seat_count"))
        for r in result.get("rows") or ()
    ]
    first = (result.get("rows") or [{}])[0]
    contract = result.get("contract") or {}
    return _Read(rows, first.get("direction", contract.get("direction")),
                 first.get("unit", contract.get("unit")))


def _read_demographic(card: CardConfig, result: dict) -> _Read:
    level, parts = card.rank.level, card.rank.partition_by
    rows = []
    for r in result.get("rows") or ():
        dims = r["dimensions"]
        rows.append(_Row(
            entity=f"{level}={dims[level]['value']}", labels={level: dims[level]["value"]},
            partition={p: dims[p]["value"] for p in parts},
            value=_value_fields(r), eligible=None))
    contract = result.get("contract") or {}
    return _Read(rows, contract.get("direction"), contract.get("unit"))


_READERS: dict[str, Callable[[CardConfig, dict], _Read]] = {
    "seat_ranking": _read_seat, "demographic_ranking": _read_demographic}


def _group_key(partition: Mapping[str, str | None]) -> str:
    return row_key([(name, value, False) for name, value in partition.items()])


def translate_ranked(card: CardConfig, results: Mapping[str, dict], ctx: TranslateContext,
                     *, failed: Collection[str] = (), labels: object | None = None) -> RankedPayload:
    """`results` and `failed` are keyed by observation id; `ctx.anchor` names the anchor."""
    rank = card.rank
    if ctx.anchor not in results:
        raise ValueError("the anchor round's ranking is missing")
    read = _READERS[card.family]
    parsed = {obs: read(card, result) for obs, result in results.items()}

    index: dict[str, dict[tuple[str, str], _Row]] = {}
    for obs, found in parsed.items():
        seen: dict[tuple[str, str], _Row] = {}
        for row in found.rows:
            key = (row.entity, _group_key(row.partition))
            if key in seen:
                raise ValueError(f"duplicate ranking row {key} in round {obs}")
            seen[key] = row
        index[obs] = seen

    anchor_rows = parsed[ctx.anchor].rows
    partitions = {_group_key(r.partition): r.partition for r in anchor_rows}
    by_group: dict[str, list[tuple[int, _Row]]] = {g: [] for g in partitions}
    for position, row in enumerate(anchor_rows):
        by_group[_group_key(row.partition)].append((position, row))

    rounds = [o for o in ctx.round_order if o in results or o in failed]
    entities: dict[str, RankedEntity] = {}
    groups: list[RankedGroup] = []
    ranks: list[RankedValue] = []
    absent: list[AbsentSlot] = []
    for gkey in sorted(partitions):
        ordered = sorted(by_group[gkey], key=lambda p: (p[1].value["rank"] is None,
                                                         p[1].value["rank"] or 0, p[0]))
        keys = [row.entity for _, row in ordered]
        for _, row in ordered:
            entities.setdefault(row.entity, RankedEntity(key=row.entity, labels=row.labels))
        eligible = {obs: next((r.eligible for r in found.rows
                               if _group_key(r.partition) == gkey), None)
                    for obs, found in parsed.items()}
        groups.append(RankedGroup(key=gkey, partition=partitions[gkey], entities=keys,
                                  eligible_count=eligible))
        for entity in keys:
            for obs in rounds:
                row = index.get(obs, {}).get((entity, gkey))
                if row is not None:
                    ranks.append(RankedValue(entity=entity, group=gkey, round=obs, **row.value))
                    continue
                reason = ("round_failed" if obs in failed and obs not in results
                          else "outside_top_k" if rank.top_k is not None else "not_ranked")
                absent.append(AbsentSlot(entity=entity, group=gkey, round=obs, reason=reason))

    contracts = {obs: dict(result.get("contract") or {}) for obs, result in results.items()}
    anchor_read = parsed[ctx.anchor]
    return RankedPayload(
        family=card.family, card_id=ctx.card_id, mode=card.comparison.mode, state=ctx.state,
        rounds=ctx.rounds,
        entity_kind="demographic" if card.family == "demographic_ranking" else "seat",
        level=rank.level, partition_by=list(rank.partition_by), top_k=rank.top_k,
        direction=anchor_read.direction, unit=anchor_read.unit,
        groups=groups, entities=list(entities.values()), ranks=ranks, absent=absent,
        unavailable=ctx.unavailable, not_asked=ctx.not_asked,
        coverage=[{"job": f"rank:{obs}", "part": "grid", "coverage": c["coverage"]}
                  for obs, c in contracts.items() if "coverage" in c],
        contracts=contracts, rules_version=ctx.rules_version, engine_version=ctx.engine_version,
        metadata_revision=ctx.metadata_revision, alliance_epoch=ctx.alliance_epoch)
