"""Engine job and run-plan types shared by the card compiler and the runner.

The per-card planning lives in matbodh_dashboard/cards/compile.py. Each job is
compiled only over the rounds that asked its question; the other rounds are
reported in ``RunPlan.not_asked``. Observation ids stay global (o1..oN over all
selected rounds) so cells from different jobs line up.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

from matbodh_dashboard.catalogue.store import DatasetVersion
from matbodh_dashboard.compiler.rounds import ResolvedRound


@dataclass(frozen=True)
class EngineJob:
    key: str
    kind: Literal["analysis", "benchmark", "relationship", "selection"]
    part: str  # "grid" for the card families
    config: dict


@dataclass(frozen=True)
class RunPlan:
    card_id: str
    state: str
    rounds: tuple[ResolvedRound, ...]
    anchor: str
    compare: str | None
    jobs: tuple[EngineJob, ...]
    unavailable: tuple[tuple[str, str], ...]
    # (part, base names of selected rounds that did not ask its question)
    not_asked: tuple[tuple[str, tuple[str, ...]], ...] = ()
    # Plain-language remarks about how the card was fitted to the context (shown by Configure).
    notes: tuple[str, ...] = ()


@lru_cache(maxsize=1)
def _engine_master_fields() -> frozenset[str]:
    """Seat attributes the engine resolves from masters, not from responses.

    The engine's MetadataSession adds these to every observation's available
    fields (metadata_runtime.py), so metadata never lists them per dataset.
    """
    from matbodh_dash.catalog import default_fields

    return frozenset(k for k, f in default_fields().items() if f.source == "master")


@lru_cache(maxsize=1)
def _pc_keyed_fields() -> frozenset[str]:
    """Master attributes the engine joins on the stored PC number (mysql_access.prepare's rule)."""
    from matbodh_dash.catalog import default_fields
    from matbodh_dash.mysql_access import PC_ATTRIBUTES

    return frozenset(k for k, f in default_fields().items()
                     if f.source == "master" and (f.master_key == "pc_num" or f.master_attribute in PC_ATTRIBUTES))


def master_key_of(field: str) -> str | None:
    """The stored respondent number a master attribute joins on, or None for a survey field."""
    if field not in _engine_master_fields():
        return None
    return "pc_num" if field in _pc_keyed_fields() else "ac_num"


def field_available(dataset: DatasetVersion, field: str) -> bool:
    return field in dataset.fields or field in _engine_master_fields()


def rounds_block(plan: RunPlan, anchor: str, compare: str | None) -> dict:
    """The RoundsBlock sent to the browser: round items, series groups, anchor and
    compare observation ids."""
    items = []
    groups: list[dict] = []
    for r in plan.rounds:
        ds = r.dataset
        items.append({
            "obs_id": r.obs_id,
            "label": r.label,
            "base_name": r.identity.base_name,
            "cycle": r.identity.cycle,
            "series": r.identity.series,
            "round": r.identity.round,
            "dataset_id": ds.dataset_id,
            "version": ds.variant,
            "fallback": r.fallback,
            # Metadata coverage (surveyed seats), not a seat estimate.
            "seats": len(ds.seat_ids),
            "borrowed": len(ds.borrowed_seat_ids),
            "seats_source": "metadata",
        })
        key = (r.identity.cycle, r.identity.series)
        if groups and (groups[-1]["cycle"], groups[-1]["series"]) == key:
            groups[-1]["obs_ids"].append(r.obs_id)
        else:
            groups.append({"cycle": key[0], "series": key[1], "obs_ids": [r.obs_id]})
    return {"items": items, "groups": groups, "anchor": anchor, "compare": compare}
