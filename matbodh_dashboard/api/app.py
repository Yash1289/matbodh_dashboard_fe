"""HTTP API over the card run service.

Read-only and calculation-free: every survey number comes from the engine via
CardRunService; the API only validates, routes and reshapes metadata.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import asdict

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from matbodh_dashboard.api.schemas import (
    CardRequest, MetadataRefreshed, RunStarted, StatesResponse,
)
from matbodh_dashboard.capability import validate_context
from matbodh_dashboard.catalogue.labels import series_groups, short_labels
from matbodh_dashboard.catalogue.store import Catalogue, CatalogueRound, DatasetVersion
from matbodh_dashboard.runner.service import CardRunService

log = logging.getLogger(__name__)

_LEVELS = ("ac", "pc", "zone", "state")
PRINCIPAL_HEADER = "X-Dashboard-User"


def create_app(
    service: CardRunService,
    catalogue_loader: Callable[[], Catalogue] | None = None,
) -> FastAPI:
    app = FastAPI(title="MatBodh dashboard API")

    @app.middleware("http")
    async def copy_principal(request: Request, call_next):
        # No access control yet: the principal is recorded for later use only.
        request.state.principal = request.headers.get(PRINCIPAL_HEADER)
        return await call_next(request)

    @app.get("/catalogue/states", response_model=StatesResponse)
    def states() -> StatesResponse:
        return StatesResponse(states=list(service.catalogue.states()))

    @app.get("/catalogue/{state}/surveys")
    def surveys(state: str) -> dict:
        catalogue = service.catalogue
        if state not in catalogue.states():
            raise HTTPException(404, f"unknown state {state!r}")
        levels = {}
        for level in _LEVELS:
            rounds = catalogue.rounds(state, level)
            if rounds:
                levels[level] = _level_groups(rounds)
        # Skipped datasets carry no state in the catalogue; all are listed so
        # nothing is hidden.
        skipped = [{"dataset_id": d, "reason": r} for d, r in catalogue.skipped]
        return {"state": state, "levels": levels, "skipped": skipped}

    @app.get("/templates")
    def templates(section: str | None = None) -> list[dict]:
        return [t.model_dump() for t in service.templates.values()
                if section is None or t.section == section]

    @app.post("/cards/plan")
    def plan(body: CardRequest):
        _require_card(service, body.card_id)
        errors = validate_context(body.context, service.catalogue)
        if errors:
            return _invalid(errors)
        run_plan = service.plan(body.card_id, body.context)
        coverage_mode: dict[str, str | None] = {}
        for job in run_plan.jobs:
            coverage_mode.setdefault(
                job.part, job.config.get("request", {}).get("coverage_mode"))
        return {
            "valid": True,
            "errors": [],
            "unavailable": [{"part": p, "reason": r} for p, r in run_plan.unavailable],
            "rounds": [
                {"obs_id": r.obs_id, "label": r.label,
                 "base_name": r.identity.base_name, "round": r.identity.round,
                 "dataset_id": r.dataset.dataset_id, "version": r.dataset.variant,
                 "fallback": r.fallback, "seats": len(r.dataset.seat_ids),
                 "borrowed": len(r.dataset.borrowed_seat_ids)}
                for r in run_plan.rounds
            ],
            "coverage_mode": coverage_mode,
        }

    @app.post("/cards/run", response_model=RunStarted)
    def run(body: CardRequest):
        _require_card(service, body.card_id)
        errors = validate_context(body.context, service.catalogue)
        if errors:
            return _invalid(errors)
        return RunStarted(run_id=service.start(body.card_id, body.context))

    @app.get("/runs/{run_id}")
    def run_status(run_id: str) -> dict:
        try:
            return asdict(service.status(run_id))
        except KeyError:
            raise HTTPException(404, f"unknown run {run_id!r}") from None

    @app.post("/admin/metadata/refreshed", response_model=MetadataRefreshed)
    def metadata_refreshed():
        if catalogue_loader is None:
            raise HTTPException(
                503, "metadata refresh is not configured: no catalogue loader was provided")
        # Exception messages may carry connection details: log only the type.
        try:
            catalogue = catalogue_loader()
        except Exception as exc:
            log.error("catalogue reload failed: %s", type(exc).__name__)
            raise HTTPException(502, "catalogue reload failed; see server logs") from None
        try:
            epoch = service.refresh_metadata(catalogue)
        except Exception as exc:
            log.error("metadata refresh failed: %s", type(exc).__name__)
            raise HTTPException(502, "metadata refresh failed; see server logs") from None
        return MetadataRefreshed(revision=catalogue.revision, alliance_epoch=epoch)

    return app


def _require_card(service: CardRunService, card_id: str) -> None:
    if card_id not in service.templates:
        raise HTTPException(404, f"unknown card {card_id!r}")


def _invalid(errors: list[str]) -> JSONResponse:
    return JSONResponse(status_code=422, content={"valid": False, "errors": errors})


def _level_groups(rounds: tuple[CatalogueRound, ...]) -> list[dict]:
    identities = [r.identity for r in rounds]
    try:
        labels = short_labels(identities)
    except ValueError:  # ambiguous short labels: the full base name is unambiguous
        labels = {i: i.base_name for i in identities}
    by_identity = {r.identity: r for r in rounds}
    groups = []
    for title, members in series_groups(identities):
        groups.append({
            "group": title,
            "cycle": members[0].cycle,
            "series": members[0].series,
            "rounds": [
                {"base_name": m.base_name, "label": labels[m], "round": m.round,
                 "versions": _versions(by_identity[m])}
                for m in members
            ],
        })
    return groups


def _versions(round_: CatalogueRound) -> dict:
    return {
        name: _version(version)
        for name, version in (("normal", round_.normal), ("extrapolated", round_.extrapolated))
        if version is not None
    }


def _version(v: DatasetVersion) -> dict:
    return {
        "seats": len(v.seat_ids),
        "borrowed": len(v.borrowed_seat_ids),
        "start_date": v.start_date.isoformat() if v.start_date else None,
        "end_date": v.end_date.isoformat() if v.end_date else None,
    }
