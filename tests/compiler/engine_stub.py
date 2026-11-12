"""Stand-in for a metadata session: expands named observations into explicit ones.

Mirrors matbodh_dash.metadata_runtime.MetadataSession._load_observation:
available fields are the dataset's fields plus every engine master attribute,
and the native seat ids become completed_acs (AC level) or completed_pcs (PC
level). Party identity namespace/version/mapping are normally supplied by the
alliance runtime.
"""

from __future__ import annotations

import copy

from matbodh_dash import LeaningEngine
from matbodh_dash.catalog import default_fields
from matbodh_dash.configuration import request_from_dict

from matbodh_dashboard.compiler.rounds import ResolvedRound

_MASTERS = tuple(k for k, f in default_fields().items() if f.source == "master")


def explicit_request(request: dict, rounds: list[ResolvedRound]) -> dict:
    by_id = {r.obs_id: r.dataset for r in rounds}
    data = copy.deepcopy(request)
    observations = []
    for obs in data["observations"]:
        ds = by_id[obs["id"]]
        seats = sorted(ds.seat_ids)
        observations.append(
            {
                "id": obs["id"],
                "survey_id": ds.dataset_id,
                "collection_level": ds.level,
                "available_fields": list(dict.fromkeys([*sorted(ds.fields), *_MASTERS])),
                "available_scenarios": sorted(ds.scenarios),
                "completed_acs": seats if ds.level == "ac" else None,
                "completed_pcs": seats if ds.level == "pc" else None,
                "dataset_id": ds.dataset_id,
                "survey_name": ds.survey_name,
            }
        )
    data["observations"] = observations
    data["parties"].update(namespace="MatBodh", version="test", mapping={})
    return data


def resolve_with_engine(request: dict, rounds: list[ResolvedRound]) -> dict:
    parsed = request_from_dict(explicit_request(request, rounds))
    return LeaningEngine().resolve(parsed)


def validate_benchmark_with_engine(config: dict, rounds: list[ResolvedRound]) -> None:
    """The engine's own pre-connection benchmark validation (no roster needed)."""
    from matbodh_views.benchmark import benchmark_view_from_dict, validate_benchmark_view

    request = request_from_dict(explicit_request(config["request"], rounds))
    view = benchmark_view_from_dict(copy.deepcopy(config["benchmark"]))
    validate_benchmark_view(LeaningEngine(), request, view)


def validate_relationship_with_engine(config: dict, rounds: list[ResolvedRound]) -> None:
    """The engine's own pre-connection relationship validation (strict loader, then resolve)."""
    from matbodh_dash.configuration import relationship_from_dict
    from matbodh_dash.joint_relationships import resolve_relationship

    request = request_from_dict(explicit_request(config["request"], rounds))
    relationship = relationship_from_dict(copy.deepcopy(config["relationship"]))
    resolve_relationship(LeaningEngine(), request, relationship)
