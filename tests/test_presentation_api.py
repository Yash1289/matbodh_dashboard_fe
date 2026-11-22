from __future__ import annotations

from pathlib import Path

import fakeredis
import pytest
from fastapi.testclient import TestClient

from matbodh_dashboard.api.app import create_app
from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.registry import load_rules
from matbodh_dashboard.runner.cache import ResultCache
from matbodh_dashboard.runner.queue import InlineQueue
from matbodh_dashboard.runner.service import CardRunService
from tests.fixtures.catalogue_rows import make_query
from tests.runner.test_service import CARDS, PRESET, RULES_YAML, FakeRunner


@pytest.fixture
def service(tmp_path):
    (tmp_path / "global.yaml").write_text(RULES_YAML, encoding="utf-8")
    cache = ResultCache(fakeredis.FakeStrictRedis(), ttl_seconds=3600)
    runner = FakeRunner()
    queue = InlineQueue(runner, cache, sleep=lambda s: None)
    return CardRunService(
        load_catalogue(make_query()),
        PRESET,
        CARDS,
        load_rules(tmp_path),
        cache,
        queue,
        "0.8.0",
    )


@pytest.fixture
def client(service):
    return TestClient(create_app(service))


@pytest.fixture
def real_client(service):
    """The endpoint over the repo's own rule files, as in production."""
    service.rules = load_rules(Path(__file__).resolve().parents[1] / "config" / "presentation")
    return TestClient(create_app(service))


def test_endpoint_serves_the_up_gender_age_and_category_orders(real_client):
    order = real_client.get("/presentation/Uttar Pradesh").json()["rowOrder"]
    assert order["gender"] == ["Male", "Female"]
    assert order["age_group"] == ["18-23", "24-35", "36-50", "51-60", "60+"]
    assert order["category"] == ["GEN", "Yadav", "NY-OBC", "Jatav", "NJ-SC/ST", "Muslim"]


def test_get_presentation_rules_for_state(real_client):
    client = real_client
    res = client.get("/presentation/Uttar Pradesh")
    assert res.status_code == 200
    data = res.json()
    assert "rowOrder" in data
    assert "columnOrder" in data
    assert "pinLast" in data
    assert "entityColors" in data

    assert "NDA" in data["columnOrder"]
    assert "Other" in data["pinLast"]
    assert "NDA" in data["entityColors"]
    # Uttar Pradesh specific party zone in rowOrder
    if isinstance(data["rowOrder"], dict):
        assert "party_zone" in data["rowOrder"]
        assert "Big Leader Politics Belt" in data["rowOrder"]["party_zone"]
    else:
        assert "Big Leader Politics Belt" in data["rowOrder"]


def test_get_presentation_rules_with_api_prefix(client):
    res = client.get("/api/presentation/Uttar Pradesh")
    assert res.status_code == 200
    data = res.json()
    assert "columnOrder" in data
    assert "NDA" in data["columnOrder"]


def test_get_presentation_rules_slug_case(client):
    res = client.get("/presentation/uttar-pradesh")
    assert res.status_code == 200
    data = res.json()
    assert "columnOrder" in data
    assert "NDA" in data["columnOrder"]


def test_get_presentation_rules_unknown_state_returns_defaults(client):
    res = client.get("/presentation/Unknown State")
    assert res.status_code == 200
    data = res.json()
    assert "columnOrder" in data
    assert "NDA" in data["columnOrder"]
