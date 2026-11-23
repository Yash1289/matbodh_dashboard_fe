"""Reshape one engine benchmark result into a BenchmarkPayload (spec sections 7 and 8).

Values are copied, never computed. The only decisions made here are which side of a row is a
dash (a party absent from that endpoint's alliance mapping) and which tables can exist.
"""
from __future__ import annotations

import copy
from collections.abc import Mapping
from typing import Any

from matbodh_dashboard.cards.benchmark.payload import (
    BenchmarkGroup, BenchmarkPayload, BucketRow, ComparisonRow, FlipRow, SummaryRow,
)
from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.translate import TranslateContext

_SIDES = ("target", "reference")
_BULKY = frozenset({"selected_seats", "completed_acs", "completed_pcs"})


def _group(row: Mapping[str, Any]) -> BenchmarkGroup:
    return BenchmarkGroup(set_id=row["grouping_set_id"],
                          dimensions={k: str(v) for k, v in row["dimensions"].items()})


def _slim(value: Any) -> Any:
    """The contract without the seat-id lists (hundreds of ids per endpoint) the card never shows."""
    if isinstance(value, dict):
        return {k: _slim(v) for k, v in value.items() if k not in _BULKY}
    if isinstance(value, list):
        return [_slim(v) for v in value]
    return copy.deepcopy(value)


def _reference(spec: Mapping[str, Any] | None, context: TranslateContext, target_question: str | None = None) -> dict:
    if spec is None:
        return {"kind": "none", "label": None}
    if spec["source"] == "election":
        c = spec["context"]
        return {"kind": "election", "label": f"{c['year']} {c['election_type']}"}
    label = context.labels.get(spec["observation"], spec["observation"])
    # Another question on the comparison survey: name it, or the two sides would read the same.
    return {"kind": "compare", "label": label if spec["scenario"] == target_question else f"{label} · {spec['scenario']}"}


def translate_benchmark(card: CardConfig, result: Mapping[str, Any], job_config: Mapping[str, Any],
                        endpoint_parties: Mapping[str, frozenset[str]],
                        context: TranslateContext) -> BenchmarkPayload:
    benchmark = job_config["benchmark"]
    other_label = job_config["request"]["parties"]["other_grouping"]["label"]
    reference_spec = benchmark["reference"]
    role = {benchmark["target"]["id"]: "target"}
    if reference_spec is not None:
        role[reference_spec["id"]] = "reference"
    focal = benchmark["focal_party"]

    def missing(party: str, side: str) -> bool:
        return party != other_label and party not in endpoint_parties.get(side, frozenset())

    summaries = []
    for r in result["summaries"]:
        side = role[r["endpoint"]]
        absent = missing(r["party_id"], side)
        summaries.append(SummaryRow(
            endpoint=side, group=_group(r), party=r["party_id"], eligible_seats=r["eligible_seat_count"],
            seats=None if absent else r["seat_count"],
            seat_share=None if absent else r["seat_share"],
            vote_share=None if absent else r["vote_share"],
            support_mass=None if absent else r["support_mass"],
            support_base=None if absent else r["support_base"],
            absent="not_in_endpoint_mapping" if absent else None))

    comparisons = []
    for r in result["comparisons"]:
        party = r["party_id"]
        gone = [s for s in _SIDES if missing(party, s)]
        comparisons.append(ComparisonRow(
            group=_group(r), party=party, eligible_seats=r["eligible_seat_count"],
            target_vote_share=None if "target" in gone else r["target_vote_share"],
            reference_vote_share=None if "reference" in gone else r["reference_vote_share"],
            vote_share_delta_pp=None if gone else r["vote_share_delta_pp"],
            target_seats=None if "target" in gone else r["target_seat_count"],
            reference_seats=None if "reference" in gone else r["reference_seat_count"],
            seat_delta=None if gone else r["seat_count_delta"],
            seat_share_delta_pp=None if gone else r["seat_share_delta_pp"],
            absent_sides=gone))

    has_reference = reference_spec is not None
    available = ["summary"]
    if has_reference:
        available.append("comparison")
    if focal is not None:
        available.append("margin_buckets")
    if has_reference and focal is not None:
        available.append("flips")
    wanted = card.view.table if card.view else None
    default = wanted if wanted in available else ("comparison" if has_reference else "summary")

    return BenchmarkPayload(
        family=card.family, card_id=context.card_id, state=context.state, rounds=context.rounds,
        reference=_reference(reference_spec, context, benchmark["target"]["scenario"]),
        anchor_question=(benchmark["target"]["scenario"] if reference_spec is not None
                         and reference_spec.get("scenario", benchmark["target"]["scenario"])
                         != benchmark["target"]["scenario"] else None),
        focal_party=focal,
        # The party rule's order (Uttar Pradesh: NDA, SP+, BSP, ...); the rows and Summary columns follow this list.
        parties=context.rules.order("party", benchmark["contenders"], states=[context.state]),
        other_label=other_label,
        endpoint_parties={s: sorted(p) for s, p in endpoint_parties.items()},
        tables_available=available, default_table=default,
        comparisons=comparisons, summaries=summaries,
        margin_buckets=[BucketRow(endpoint=role[r["endpoint"]], group=_group(r), bucket=r["bucket"],
                                  seats=r["seat_count"], eligible_seats=r["eligible_seat_count"])
                        for r in result["margin_buckets"]],
        flips=[FlipRow(group=_group(r), bucket=r["bucket"], seats=r["seat_count"],
                       eligible_seats=r["eligible_seat_count"]) for r in result["flips"]],
        contract=_slim(result["contract"]), unavailable=context.unavailable,
        rules_version=context.rules_version, engine_version=context.engine_version,
        metadata_revision=context.metadata_revision, alliance_epoch=context.alliance_epoch)
