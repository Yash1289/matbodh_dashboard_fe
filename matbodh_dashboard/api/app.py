"""HTTP API over the card run service.

Read-only and calculation-free: every survey number comes from the engine via
CardRunService; the API only validates, routes and reshapes metadata.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from matbodh_dashboard.api.schemas import (
    CardRequest, MetadataRefreshed, RunStarted, StatesResponse,
)
from matbodh_dashboard.capability import validate_context
from matbodh_dashboard.cards.families import family_meta, get_family
from matbodh_dashboard.catalogue.labels import series_groups, short_labels
from matbodh_dashboard.catalogue.store import (
    Catalogue, CatalogueRound, DatasetVersion, RoundNotFound)
from matbodh_dashboard.runner.service import CardRunService

log = logging.getLogger(__name__)

_LEVELS = ("ac", "pc", "zone", "state")
PRINCIPAL_HEADER = "X-Dashboard-User"


DEFAULT_COLUMN_ORDER = ["NDA", "SP+", "BSP", "Other", "Undecided", "NOTA"]
DEFAULT_PIN_LAST = ["Other", "Undecided", "NOTA"]
DEFAULT_ENTITY_COLORS = {
    "NDA": "#ff9933",
    "SP+": "#e11d48",
    "BSP": "#1e40af",
    "INC": "#0ea5e9",
    "Other": "#64748b",
    "Undecided": "#94a3b8",
    "NOTA": "#94a3b8",
}


def get_presentation_rules(
    state: str,
    service: CardRunService,
    config_dir: Path | None = None,
) -> dict:
    if config_dir is None:
        env_dir = os.environ.get("DASHBOARD_CONFIG_DIR")
        config_dir = Path(env_dir) if env_dir else Path(__file__).resolve().parent.parent.parent / "config"

    column_order = list(DEFAULT_COLUMN_ORDER)
    pin_last = list(DEFAULT_PIN_LAST)
    entity_colors = dict(DEFAULT_ENTITY_COLORS)
    row_order_by_field: dict[str, list[str]] = {}

    if hasattr(service, "rules") and service.rules:
        for r in service.rules.rules:
            if r.field == "party":
                if r.order:
                    column_order = list(r.order)
                if r.pin_last:
                    pin_last = list(r.pin_last)
                if r.colours:
                    entity_colors.update(r.colours)
            elif r.state in (None, state) and r.order:
                row_order_by_field[r.field] = list(r.order)

    pres_dir = config_dir / "presentation"
    if pres_dir.is_dir():
        global_file = pres_dir / "global.yaml"
        if global_file.is_file():
            try:
                gdoc = yaml.safe_load(global_file.read_text(encoding="utf-8")) or {}
                for raw_r in gdoc.get("rules", []):
                    if raw_r.get("field") == "party":
                        if "order" in raw_r and isinstance(raw_r["order"], list):
                            column_order = list(raw_r["order"])
                        if "pin_last" in raw_r and isinstance(raw_r["pin_last"], list):
                            pin_last = list(raw_r["pin_last"])
                        if "colours" in raw_r and isinstance(raw_r["colours"], dict):
                            entity_colors.update(raw_r["colours"])
            except Exception as e:
                log.warning("Failed to read global presentation rules: %s", e)

        slug = state.lower().strip().replace(" ", "-")
        candidates = [
            pres_dir / f"{slug}.yaml",
            pres_dir / f"{state}.yaml",
            pres_dir / f"{state.lower().strip()}.yaml",
        ]
        state_file = next((f for f in candidates if f.is_file()), None)
        if state_file is not None:
            try:
                sdoc = yaml.safe_load(state_file.read_text(encoding="utf-8")) or {}
                for raw_r in sdoc.get("rules", []):
                    fld = raw_r.get("field")
                    if fld == "party":
                        if "order" in raw_r and isinstance(raw_r["order"], list):
                            column_order = list(raw_r["order"])
                        if "pin_last" in raw_r and isinstance(raw_r["pin_last"], list):
                            pin_last = list(raw_r["pin_last"])
                        if "colours" in raw_r and isinstance(raw_r["colours"], dict):
                            entity_colors.update(raw_r["colours"])
                    elif fld and "order" in raw_r and isinstance(raw_r["order"], list):
                        row_order_by_field[fld] = list(raw_r["order"])
            except Exception as e:
                log.warning("Failed to read state presentation rules for %s: %s", state, e)

    return {
        "state": state,
        "rowOrder": row_order_by_field,
        "columnOrder": column_order,
        "pinLast": pin_last,
        "entityColors": entity_colors,
    }


def create_app(
    service: CardRunService,
    catalogue_loader: Callable[[], Catalogue] | None = None,
    config_dir: Path | None = None,
) -> FastAPI:
    app = FastAPI(title="MatBodh dashboard API")

    @app.middleware("http")
    async def copy_principal(request: Request, call_next):
        # No access control yet: the principal is recorded for later use only.
        request.state.principal = request.headers.get(PRINCIPAL_HEADER)
        return await call_next(request)

    @app.get("/presentation/{state}")
    @app.get("/api/presentation/{state}")
    def presentation(state: str) -> dict:
        return get_presentation_rules(state, service, config_dir)

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

    @app.get("/catalogue/{state}/elections")
    def elections(state: str) -> list[dict]:
        return [o.model_dump() for o in service.elections.get(state, [])]

    @app.get("/cards")
    def cards(section: str | None = None) -> list[dict]:
        return [{**c.model_dump(), "meta": family_meta(get_family(c.family)).model_dump()}
                for c in service.cards.values()
                if section is None or c.section == section]

    @app.post("/cards/plan")
    def plan(body: CardRequest):
        _require_card(service, body.card_id)
        errors = validate_context(body.context, service.catalogue)
        if errors:
            return _invalid(errors)
        try:
            run_plan = service.plan(body.card_id, body.context, body.reference)
        except RoundNotFound:
            raise _catalogue_changed() from None
        coverage_mode: dict[str, str | None] = {}
        for job in run_plan.jobs:
            coverage_mode.setdefault(
                job.part, job.config.get("request", {}).get("coverage_mode"))
        return {
            "valid": True,
            "errors": [],
            "unavailable": [{"part": p, "reason": r} for p, r in run_plan.unavailable],
            "not_asked": [{"part": p, "rounds": list(names)}
                          for p, names in run_plan.not_asked],
            "rounds": [
                {"obs_id": r.obs_id, "label": r.label,
                 "base_name": r.identity.base_name, "round": r.identity.round,
                 "dataset_id": r.dataset.dataset_id, "version": r.dataset.variant,
                 "fallback": r.fallback, "seats": len(r.dataset.seat_ids),
                 "borrowed": len(r.dataset.borrowed_seat_ids), "seats_source": "metadata"}
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
        try:
            return RunStarted(run_id=service.start(body.card_id, body.context, body.reference))
        except RoundNotFound:
            raise _catalogue_changed() from None

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
    if card_id not in service.cards:
        raise HTTPException(404, f"unknown card {card_id!r}")


def _catalogue_changed() -> HTTPException:
    """A refresh swapped the catalogue between validation and planning."""
    return HTTPException(409, "the survey catalogue changed while the request was being "
                              "processed; reload the catalogue and retry")


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
