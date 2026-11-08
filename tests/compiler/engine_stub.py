"""Stand-in for a metadata session: expands named observations into explicit ones."""

from __future__ import annotations

import copy

from matbodh_dash import LeaningEngine
from matbodh_dash.configuration import request_from_dict

from matbodh_dashboard.compiler.rounds import ResolvedRound


def explicit_request(request: dict, rounds: list[ResolvedRound]) -> dict:
    by_id = {r.obs_id: r.dataset for r in rounds}
    data = copy.deepcopy(request)
    observations = []
    for obs in data["observations"]:
        ds = by_id[obs["id"]]
        observations.append(
            {
                "id": obs["id"],
                "survey_id": ds.dataset_id,
                "collection_level": ds.level,
                "available_fields": sorted(ds.fields),
                "available_scenarios": sorted(ds.scenarios),
                "completed_acs": sorted(ds.seat_ids),
                "dataset_id": ds.dataset_id,
                "survey_name": ds.survey_name,
            }
        )
    data["observations"] = observations
    # Party identity namespace/version/mapping are normally supplied by the alliance runtime.
    data["parties"].update(namespace="MatBodh", version="test", mapping={})
    return data


def resolve_with_engine(request: dict, rounds: list[ResolvedRound]) -> dict:
    parsed = request_from_dict(explicit_request(request, rounds))
    return LeaningEngine().resolve(parsed)
