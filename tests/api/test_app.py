"""HTTP API: catalogue, templates, planning, runs and metadata refresh.

The service is built on fakeredis, an inline queue and the fake engine runner
from the service tests; the API itself must never compute survey numbers.
"""

from __future__ import annotations

import logging

import fakeredis
import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from matbodh_dashboard.api.app import create_app
from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.registry import load_rules
from matbodh_dashboard.runner.cache import ResultCache
from matbodh_dashboard.runner.queue import InlineQueue
from matbodh_dashboard.runner.service import CardRunService
from tests.fixtures.catalogue_rows import DATASET_ROWS, dataset_row, make_query
from tests.runner.test_service import (
    PRESET, RULES_YAML, SCOREBOARD, TEMPLATES, FakeRunner,
)

STATE = "Uttar Pradesh"
R1, R2 = "2027 VS CAPI R1", "2027 VS CAPI R2"
ZONE_R1 = "2027 VS CAPI ST R1"


@pytest.fixture
def parts(tmp_path):
    (tmp_path / "global.yaml").write_text(RULES_YAML, encoding="utf-8")
    cache = ResultCache(fakeredis.FakeStrictRedis(), ttl_seconds=3600)
    runner = FakeRunner()
    queue = InlineQueue(runner, cache, sleep=lambda s: None)
    service = CardRunService(load_catalogue(make_query()), PRESET, TEMPLATES,
                             load_rules(tmp_path), cache, queue, "0.8.0")
    return service, runner


@pytest.fixture
def service(parts):
    return parts[0]


@pytest.fixture
def client(service):
    return TestClient(create_app(service))


def body(card=SCOREBOARD, **ctx):
    context = {"state": STATE, "level": "ac", "rounds": [R1, R2], "compare_round": R1}
    context.update(ctx)
    return {"card_id": card, "context": context}


def test_states_listed(client):
    response = client.get("/catalogue/states")
    assert response.status_code == 200
    assert response.json() == {"states": [STATE]}


def test_surveys_grouped_by_level_and_series(client):
    data = client.get(f"/catalogue/{STATE}/surveys").json()
    assert list(data["levels"]) == ["ac", "zone"]
    (group,) = data["levels"]["ac"]
    assert group["cycle"] == "2027 VS" and group["series"] == "CAPI"
    r1, r2 = group["rounds"]
    assert (r1["base_name"], r1["label"], r1["round"]) == (R1, "R1", 1)
    assert r1["versions"] == {"normal": {"seats": 380, "borrowed": 0,
                                         "start_date": "2027-01-01",
                                         "end_date": "2027-01-31"}}
    assert set(r2["versions"]) == {"normal", "extrapolated"}
    assert r2["versions"]["extrapolated"]["seats"] == 403
    assert r2["versions"]["extrapolated"]["borrowed"] == 23
    assert data["levels"]["zone"][0]["rounds"][0]["base_name"] == ZONE_R1
    assert data["skipped"] == []


def test_surveys_report_skipped_datasets(service):
    rows = DATASET_ROWS + [dataset_row("bad one", cycle_id="nonsense")]
    service.catalogue = load_catalogue(make_query(dataset_rows=rows))
    data = TestClient(create_app(service)).get(f"/catalogue/{STATE}/surveys").json()
    assert [s["dataset_id"] for s in data["skipped"]] == ["bad one"]
    assert data["skipped"][0]["reason"]


def test_unknown_state_is_404(client):
    assert client.get("/catalogue/Nowhere/surveys").status_code == 404


def test_templates_filtered_by_section(client):
    everything = client.get("/templates").json()
    assert {t["id"] for t in everything} == set(TEMPLATES)
    pulse = client.get("/templates", params={"section": "pulse"}).json()
    assert len(pulse) == len(everything)
    assert client.get("/templates", params={"section": "nope"}).json() == []


def test_plan_rejects_mixed_levels(client, parts):
    response = client.post("/cards/plan", json=body(rounds=[R1, ZONE_R1], compare_round=None))
    assert response.status_code == 422
    data = response.json()
    assert data["valid"] is False
    assert R1 in data["errors"][0] and ZONE_R1 in data["errors"][0]
    assert parts[1].calls == []


def test_plan_reports_seats_unavailable_for_state_level(client, parts):
    response = client.post("/cards/plan", json=body(
        level="zone", rounds=[ZONE_R1], compare_round=None))
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True and data["errors"] == []
    assert {u["part"] for u in data["unavailable"]} == {"seats_ac", "seats_pc"}
    assert data["coverage_mode"] == {"vote": "independent"}
    assert parts[1].calls == []  # planning makes no engine calls


def test_plan_reports_rounds_and_coverage_mode(client):
    data = client.post("/cards/plan", json=body()).json()
    assert [r["obs_id"] for r in data["rounds"]] == ["o1", "o2"]
    assert data["rounds"][1]["version"] == "extrapolated"
    assert data["rounds"][0]["fallback"] is True
    assert set(data["coverage_mode"]) == {"vote", "parties", "seats_ac", "seats_pc"}
    assert data["unavailable"] == []


def test_unknown_card_is_404_and_bad_body_422(client):
    assert client.post("/cards/plan", json=body(card="pulse.missing")).status_code == 404
    assert client.post("/cards/run", json=body(card="pulse.missing")).status_code == 404
    assert client.post("/cards/plan", json={"card_id": SCOREBOARD}).status_code == 422


def test_run_with_invalid_context_is_422(client, parts):
    response = client.post("/cards/run", json=body(rounds=["2027 VS CAPI R9"]))
    assert response.status_code == 422
    assert "unknown round" in response.json()["errors"][0]
    assert parts[1].calls == []


def test_run_then_status_done(client):
    started = client.post("/cards/run", json=body())
    assert started.status_code == 200
    run_id = started.json()["run_id"]
    status = client.get(f"/runs/{run_id}")
    assert status.status_code == 200
    data = status.json()
    assert (data["state"], data["done"], data["total"]) == ("done", 4, 4)
    assert data["errors"] == {}
    nda = next(r for r in data["result"]["scoreboard"] if r["series"] == "NDA")
    assert nda["vote"]["value"] == 38.0 and nda["vote"]["delta"] == -1.5


def test_unknown_run_is_404(client):
    assert client.get("/runs/nope").status_code == 404


def test_refresh_bumps_epoch(service):
    fresh = load_catalogue(make_query(
        dataset_rows=[dataset_row("2027 VS CAPI R1", revision=42)]))
    client = TestClient(create_app(service, catalogue_loader=lambda: fresh))
    response = client.post("/admin/metadata/refreshed")
    assert response.status_code == 200
    assert response.json() == {"revision": 42, "alliance_epoch": 1}
    assert service.catalogue is fresh
    assert client.post("/admin/metadata/refreshed").json()["alliance_epoch"] == 2


def test_refresh_without_loader_is_503(client):
    response = client.post("/admin/metadata/refreshed")
    assert response.status_code == 503
    assert "loader" in response.json()["detail"]


def test_refresh_loader_failure_is_502_without_details(service, caplog):
    def loader():
        raise RuntimeError("password=hunter2 refused")

    client = TestClient(create_app(service, catalogue_loader=loader))
    with caplog.at_level(logging.DEBUG):
        response = client.post("/admin/metadata/refreshed")
    assert response.status_code == 502
    assert "hunter2" not in response.text
    assert "hunter2" not in caplog.text and "Traceback" not in caplog.text
    assert "RuntimeError" in caplog.text
    assert service.cache.alliance_epoch() == 0


def test_refresh_service_failure_is_502_without_details(service, caplog):
    def broken(catalogue):
        raise ConnectionError("redis://:hunter2@host down")

    service.refresh_metadata = broken
    client = TestClient(create_app(service, catalogue_loader=lambda: service.catalogue))
    with caplog.at_level(logging.DEBUG):
        response = client.post("/admin/metadata/refreshed")
    assert response.status_code == 502
    assert "hunter2" not in response.text
    assert "hunter2" not in caplog.text and "Traceback" not in caplog.text
    assert "ConnectionError" in caplog.text


def test_principal_header_copied_to_request_state(service):
    app = create_app(service)

    @app.get("/_whoami")
    def whoami(request: Request):
        return {"principal": request.state.principal}

    client = TestClient(app)
    assert client.get("/_whoami", headers={"X-Dashboard-User": "asha"}).json() == {
        "principal": "asha"}
    assert client.get("/_whoami").json() == {"principal": None}


def test_plan_reports_not_asked_rounds(client):
    data = client.post("/cards/plan", json=body(card="pulse.leaders")).json()
    assert data["not_asked"] == [{"part": "cm_satisfaction", "rounds": [R1]}]
    assert data["unavailable"] == []


def test_plan_shows_template_level_requirement(client):
    response = client.post("/cards/plan", json=body(
        card="pulse.by_zone", level="zone", rounds=[ZONE_R1], compare_round=None))
    assert response.status_code == 200
    data = response.json()
    assert [u["part"] for u in data["unavailable"]] == ["zone"]
    assert "AC-level" in data["unavailable"][0]["reason"]
