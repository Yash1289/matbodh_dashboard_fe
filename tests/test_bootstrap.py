"""Composition root wiring, with fakes only: fakeredis and a fake ClickHouse client."""

from __future__ import annotations

from pathlib import Path

import fakeredis
import pytest
from fastapi.testclient import TestClient

from matbodh_dashboard import bootstrap
from matbodh_dashboard.cards.ranking.labels import MasterSeatLabels
from matbodh_dashboard.runner.queue import RQQueue
from matbodh_dashboard.runner.service import CardRunService
from matbodh_dashboard.settings import Settings
from tests.fixtures.catalogue_rows import make_query

ROOT = Path(__file__).resolve().parents[1]
SETTINGS = Settings(Path("unused.env"), "redis://unused:6379/0", 1234, ROOT / "config")


class FakeClickHouse:
    """Answers the catalogue's two metadata queries from the fixture rows."""

    def __init__(self):
        self.query_rows = make_query()
        self.settings_seen: list[dict] = []
        self.closed = 0

    def query(self, sql, parameters=None, settings=None):
        self.settings_seen.append(settings)
        rows = self.query_rows(sql, parameters or {})
        columns = list(rows[0]) if rows else []

        class Result:
            column_names = columns
            result_rows = [tuple(r[c] for c in columns) for r in rows]

        return Result()

    def close(self):
        self.closed += 1


@pytest.fixture
def fakes(monkeypatch):
    import matbodh_views.connections as connections

    redis = fakeredis.FakeStrictRedis()
    clients: list[FakeClickHouse] = []
    urls: list[str] = []

    def client(env_file):
        assert env_file == SETTINGS.engine_env_file
        clients.append(FakeClickHouse())
        return clients[-1]

    def redis_from_url(url):
        urls.append(url)
        return redis

    monkeypatch.setattr(connections, "create_clickhouse_client", client)
    monkeypatch.setattr(bootstrap, "_redis", redis_from_url)
    return redis, clients, urls


def test_build_service_wires_settings_redis_queue_and_catalogue(fakes):
    redis, clients, urls = fakes
    service = bootstrap.build_service_from_settings(SETTINGS)
    assert isinstance(service, CardRunService)
    assert urls == [SETTINGS.redis_url]
    assert isinstance(service.queue, RQQueue)
    assert service.cache._ttl == 1234 and service.cache._redis is redis
    assert service.catalogue.states() == ("Uttar Pradesh",)
    assert service.preset.id == "uttar-pradesh.standard-v1"
    assert service.cards == {}
    assert service.rules.version
    # The catalogue query is read-only and the connection is closed after use.
    (client,) = clients
    assert client.closed == 1
    assert all(s["readonly"] == 1 for s in client.settings_seen)


def test_build_service_wires_seat_labels_to_the_catalogue_revision(fakes):
    service = bootstrap.build_service_from_settings(SETTINGS)
    assert isinstance(service.seat_labels, MasterSeatLabels)
    assert service.seat_labels._revision() == service.catalogue.revision


def test_production_library_may_be_empty(fakes):
    from matbodh_dashboard.api.app import create_app

    _, cards, _ = bootstrap.load_card_config(ROOT / "config")
    assert cards == {}  # cards.yaml ships empty: analysts build cards, the owner pastes shared ones in
    service = bootstrap.build_service_from_settings(SETTINGS)
    assert TestClient(create_app(service)).get("/cards").json() == []


def test_load_card_config_reads_cards_yaml():
    preset, cards, rules = bootstrap.load_card_config(ROOT / "config")
    assert preset.id == "uttar-pradesh.standard-v1"
    assert cards == {}
    assert rules.version
    from matbodh_dashboard.cards.config import load_cards

    seeded = load_cards(ROOT / "tests" / "fixtures" / "cards.yaml")  # the cards the tests rely on
    assert {"distribution.support_by_caste", "opinion.leaders", "gender.gap_by_zone"} <= set(seeded)
    assert seeded["opinion.leaders"].family == "opinion"


def test_catalogue_loader_closes_the_client_on_failure(monkeypatch):
    import matbodh_views.connections as connections

    client = FakeClickHouse()

    def broken(sql, parameters=None, settings=None):
        raise ConnectionError("down")

    client.query = broken
    monkeypatch.setattr(connections, "create_clickhouse_client", lambda env_file: client)
    with pytest.raises(ConnectionError):
        bootstrap.catalogue_loader(SETTINGS)()
    assert client.closed == 1


def test_create_production_app_serves_and_refreshes(fakes, monkeypatch):
    _, clients, _ = fakes
    monkeypatch.setattr(bootstrap, "load_settings", lambda: SETTINGS)
    client = TestClient(bootstrap.create_production_app())
    assert client.get("/catalogue/states").json() == {"states": ["Uttar Pradesh"]}
    refreshed = client.post("/admin/metadata/refreshed")
    assert refreshed.status_code == 200
    assert refreshed.json() == {"revision": 9, "alliance_epoch": 1}
    assert len(clients) == 2 and all(c.closed == 1 for c in clients)
