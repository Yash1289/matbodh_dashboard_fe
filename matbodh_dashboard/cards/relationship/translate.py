"""Reshape one engine relationship result into a RelationshipPayload (spec sections 6 and 7).

Values are copied, never computed. The only decisions made here are which groups are shown (a
dimension value hidden by the presentation rules drops its group), which cells exist (major by
major only) and which of those the engine had no row for (an absent cell).
"""
from __future__ import annotations

from collections.abc import Collection, Mapping
from typing import Any

from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.relationship.payload import (
    RelationshipCell, RelationshipGroup, RelationshipPayload, RelationshipSummary,
)
from matbodh_dashboard.cards.translate import TranslateContext
from matbodh_dashboard.registry import _natural_key

_CONTRACT_KEYS = ("relationship", "identities", "joint_weights", "eligibility", "normalisations",
                  "focal_bases", "population", "units", "cross_round_pairing", "grain")
_CELL_FIELDS = ("origin_share", "destination_share", "joint_share", "size_of_impact_pp", "joint_count",
                "joint_mass", "origin_base", "destination_base", "paired_base", "paired_count")
_SUMMARY_FIELDS = tuple(f for f in RelationshipSummary.model_fields if f not in ("round", "group"))


def _dimensions(row: Mapping[str, Any]) -> dict[str, str]:
    """Member dimensions only; a subtotal dimension is not part of the group."""
    return {name: "~null" if d["value"] is None else str(d["value"]) for name, d in row["dimensions"].items() if not d["is_subtotal"]}


def _group(row: Mapping[str, Any]) -> RelationshipGroup:
    return RelationshipGroup(set_id=row["grouping_set_id"], dimensions=_dimensions(row))


def _key(group: RelationshipGroup) -> tuple:
    return (group.set_id, tuple(sorted(group.dimensions.items())))


def _order(group: RelationshipGroup) -> tuple:
    """Display order: cut, then values with digit runs as numbers (g2 before g10)."""
    return (group.set_id, [(name, _natural_key(value)) for name, value in sorted(group.dimensions.items())])


def translate_relationship(card: CardConfig, result: Mapping[str, Any], job_config: Mapping[str, Any],
                           majors: Collection[str], context: TranslateContext) -> RelationshipPayload:
    rules, state = context.rules, context.state
    parties = rules.order("party", majors, states=[state])

    def shown(group: RelationshipGroup) -> bool:
        return all(value == "~null" or rules.order(dim, [value], states=[state]) == [value] for dim, value in group.dimensions.items())

    rounds_with_data = {r["observation_id"] for r in result["summaries"]}
    rounds = [o for o in context.round_order if o in rounds_with_data]

    summaries: list[RelationshipSummary] = []
    for r in result["summaries"]:
        group = _group(r)
        if shown(group):
            summaries.append(RelationshipSummary(
                round=r["observation_id"], group=group, **{f: r.get(f) for f in _SUMMARY_FIELDS}))
    order = {o: i for i, o in enumerate(rounds)}
    summaries.sort(key=lambda s: (order[s.round], _order(s.group)))

    groups: dict[tuple, RelationshipGroup] = {}
    for s in summaries:
        groups.setdefault(_key(s.group), s.group)

    engine_rows = {}
    for r in result["rows"]:
        engine_rows[(r["observation_id"], _key(_group(r)), r["origin_party"], r["destination_party"])] = r

    cells: list[RelationshipCell] = []
    for s in summaries:
        for origin in parties:
            for destination in parties:
                row = engine_rows.get((s.round, _key(s.group), origin, destination))
                values = {f: row[f] for f in _CELL_FIELDS} if row is not None else dict.fromkeys(_CELL_FIELDS)
                cells.append(RelationshipCell(
                    round=s.round, group=s.group, origin=origin, destination=destination, **values,
                    absent=None if row is not None else "no_respondents"))

    focal = job_config["relationship"]["focal_party"]
    contract = result["contract"]
    wanted = card.view.table if card.view is not None else None
    return RelationshipPayload(
        family=card.family, card_id=context.card_id, state=state, rounds=context.rounds,
        origin=job_config["relationship"]["origin"], destination=job_config["relationship"]["destination"],
        focal_party=focal, weights=contract["joint_weights"],
        answer_overrides=job_config["relationship"].get("answer_overrides"), parties=parties,
        groups=sorted(groups.values(), key=_order),
        tables_available=["summary", "matrix"], default_table=wanted or "summary",
        cells=cells, summaries=summaries,
        contract={k: contract[k] for k in _CONTRACT_KEYS if k in contract},
        not_asked=context.not_asked, unavailable=context.unavailable,
        rules_version=context.rules_version, engine_version=context.engine_version,
        metadata_revision=context.metadata_revision, alliance_epoch=context.alliance_epoch)
