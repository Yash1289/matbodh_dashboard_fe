"""HTTP API: catalogue, cards, planning, runs and metadata refresh.

The service is built on fakeredis, an inline queue and the fake engine runner
from the service tests; the API itself must never compute survey numbers.
"""

from __future__ import annotations

import logging

import fakeredis
import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from pathlib import Path

from matbodh_dashboard.api.app import create_app
from matbodh_dashboard.cards.config import load_cards
from matbodh_dashboard.catalogue.store import RoundNotFound, load_catalogue
from matbodh_dashboard.registry import load_rules
from matbodh_dashboard.runner.cache import ResultCache
from matbodh_dashboard.runner.queue import InlineQueue
from matbodh_dashboard.runner.service import CardRunService
from tests.fixtures.catalogue_rows import DATASET_ROWS, dataset_row, make_query
from tests.runner.test_service import (
    ACLEVEL, CARDS, COMPARE, PRESET, RULES_YAML, TREND, VOTE, FakeRunner,
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
    service = CardRunService(load_catalogue(make_query()), PRESET, CARDS,
                             load_rules(tmp_path), cache, queue, "0.8.0")
    return service, runner


@pytest.fixture
def service(parts):
    return parts[0]


@pytest.fixture
def client(service):
    return TestClient(create_app(service))


def body(card=VOTE.id, **ctx):
    context = {"state": STATE, "level": "ac", "rounds": [R1, R2], "compare_round": R1}
    context.update(ctx)
    return {"card_id": card, "context": context}


def test_states_listed(client):
    response = client.get("/catalogue/states")
    assert response.status_code == 200
    assert response.json() == {"states": [STATE]}


def test_plan_body_validates_an_optional_benchmark_reference(client):
    payload = body()
    payload["reference"] = {"kind": "election", "year": 2022}  # election_type missing
    assert client.post("/cards/plan", json=payload).status_code == 422
    payload["reference"] = {"kind": "none"}
    assert client.post("/cards/plan", json=payload).status_code == 200


def test_elections_endpoint_lists_options_for_a_state(service, client):
    from matbodh_dashboard.cards.benchmark.parties import ElectionOption

    service.elections = {STATE: [ElectionOption(year=2022, election_type="VS", label="2022 VS")]}
    assert client.get(f"/catalogue/{STATE}/elections").json() == [
        {"year": 2022, "election_type": "VS", "label": "2022 VS"}]
    assert client.get("/catalogue/Nowhere/elections").json() == []


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


def test_cards_listed_with_family_meta_and_filtered_by_section(client):
    everything = client.get("/cards").json()
    assert {c["id"] for c in everything} == set(CARDS)
    vote = next(c for c in everything if c["id"] == VOTE.id)
    assert vote["family"] == "distribution" and vote["cuts"] == [[], ["party_zone"]]
    assert vote["meta"]["default_lens"] == "support_share"
    assert "support_share" in [lens["id"] for lens in vote["meta"]["lenses"]]
    assert vote["meta"]["capabilities"]["modes"] == ["standalone", "compare", "trend"]
    assert len(client.get("/cards", params={"section": "t"}).json()) == len(everything)
    assert client.get("/cards", params={"section": "nope"}).json() == []


def test_seeded_ranking_cards_are_listed_without_lenses_and_plan_as_valid(tmp_path):
    (tmp_path / "global.yaml").write_text(RULES_YAML, encoding="utf-8")
    cache = ResultCache(fakeredis.FakeStrictRedis(), ttl_seconds=3600)
    seeds = load_cards(Path(__file__).resolve().parents[2] / "config/cards/cards.yaml")
    service = CardRunService(load_catalogue(make_query()), PRESET, seeds, load_rules(tmp_path),
                             cache, InlineQueue(FakeRunner(), cache), "0.8.0")
    client = TestClient(create_app(service))
    listed = {c["id"]: c for c in client.get("/cards", params={"section": "rankings"}).json()}
    assert set(listed) == {"ranking.ac_pm_net", "ranking.ac_bjp_support_by_zone",
                           "ranking.pc_pm_net", "ranking.castes_by_ac_support"}
    assert listed["ranking.ac_pm_net"]["family"] == "seat_ranking"
    assert listed["ranking.castes_by_ac_support"]["family"] == "demographic_ranking"
    assert all(c["meta"]["lenses"] == [] for c in listed.values())
    plan = client.post("/cards/plan", json=body(card="ranking.ac_pm_net")).json()
    assert plan["valid"] is True and plan["unavailable"] == []


def test_plan_rejects_mixed_levels(client, parts):
    response = client.post("/cards/plan", json=body(rounds=[R1, ZONE_R1], compare_round=None))
    assert response.status_code == 422
    data = response.json()
    assert data["valid"] is False
    assert R1 in data["errors"][0] and ZONE_R1 in data["errors"][0]
    assert parts[1].calls == []


def test_plan_reports_geography_unavailable_for_zone_level(client, parts):
    response = client.post("/cards/plan", json=body(
        level="zone", rounds=[ZONE_R1], compare_round=None))
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True and data["errors"] == []
    assert {u["part"] for u in data["unavailable"]} == {"grid"}
    assert "party_zone" in data["unavailable"][0]["reason"]
    assert data["coverage_mode"] == {}
    assert parts[1].calls == []  # planning makes no engine calls


def test_plan_reports_rounds_and_coverage_mode(client):
    data = client.post("/cards/plan", json=body()).json()
    assert [r["obs_id"] for r in data["rounds"]] == ["o1", "o2"]
    assert data["rounds"][1]["version"] == "extrapolated"
    assert data["rounds"][0]["fallback"] is True
    assert data["rounds"][0]["seats_source"] == "metadata"
    assert data["coverage_mode"] == {"grid": "independent"}
    assert data["unavailable"] == []


def test_unknown_card_is_404_and_bad_body_422(client):
    assert client.post("/cards/plan", json=body(card="t.missing")).status_code == 404
    assert client.post("/cards/run", json=body(card="t.missing")).status_code == 404
    assert client.post("/cards/plan", json={"card_id": VOTE.id}).status_code == 422


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
    assert (data["state"], data["done"], data["total"]) == ("done", 1, 1)
    assert data["errors"] == {}
    result = data["result"]
    assert result["family"] == "distribution" and result["mode"] == "standalone"
    overall = next(cut for cut in result["cuts"] if cut["id"] == "g0")
    nda = next(c for c in overall["cells"]
               if c["column"].endswith(":NDA") and c["lens"] == "support_share")
    assert nda["value"] == 38.0


def test_compare_run_returns_engine_delta(client):
    run_id = client.post("/cards/run", json=body(card=COMPARE.id)).json()["run_id"]
    result = client.get(f"/runs/{run_id}").json()["result"]
    assert result["mode"] == "compare"
    overall = next(cut for cut in result["cuts"] if cut["id"] == "g0")
    deltas = [d for d in overall["deltas"] if d["lens"] == "support_share"]
    assert deltas and all(d["value"] is not None for d in deltas)


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


def test_plan_reports_trend_unavailable_and_not_asked_when_scenario_is_in_one_round(client):
    data = client.post("/cards/plan", json=body(card=TREND.id)).json()
    assert data["not_asked"] == [{"part": "grid", "rounds": [R1]}]
    assert "at least 2" in data["unavailable"][0]["reason"]


def test_plan_shows_card_level_requirement(client):
    response = client.post("/cards/plan", json=body(
        card=ACLEVEL.id, level="zone", rounds=[ZONE_R1], compare_round=None))
    assert response.status_code == 200
    data = response.json()
    assert [u["part"] for u in data["unavailable"]] == ["grid"]
    assert "AC-level" in data["unavailable"][0]["reason"]


def test_catalogue_change_between_validation_and_start_is_409(service, monkeypatch):
    def vanished(card_id, ctx, reference=None):
        raise RoundNotFound("no round '2027 VS CAPI R1' for state 'Uttar Pradesh'")

    monkeypatch.setattr(service, "plan", vanished)
    monkeypatch.setattr(service, "start", vanished)
    client = TestClient(create_app(service))
    for path in ("/cards/plan", "/cards/run"):
        response = client.post(path, json=body())
        assert response.status_code == 409
        assert "catalogue changed" in response.json()["detail"]


def test_compare_equal_to_anchor_is_422(client):
    response = client.post("/cards/plan", json=body(compare_round=R2))
    assert response.status_code == 422
    assert any("anchor" in e for e in response.json()["errors"])
