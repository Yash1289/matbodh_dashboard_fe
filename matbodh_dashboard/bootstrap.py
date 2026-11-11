"""Composition root: settings -> Redis -> ResultCache -> RQQueue -> catalogue ->
CardRunService -> FastAPI app.

Run the API with::

    uvicorn matbodh_dashboard.bootstrap:create_production_app --factory

The API process opens ClickHouse only to load the survey catalogue (read-only
query, connection closed after each load); engine jobs run in RQ workers
(``matbodh_dashboard.runner.worker``), which own the engine connections.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import FastAPI

from matbodh_dashboard import engine_version
from matbodh_dashboard.api.app import create_app
from matbodh_dashboard.cards.config import CardConfig, load_cards
from matbodh_dashboard.cards.ranking.labels import MasterSeatLabels
from matbodh_dashboard.catalogue.store import Catalogue, clickhouse_query, load_catalogue
from matbodh_dashboard.presets import MethodPreset, load_preset
from matbodh_dashboard.registry import RuleSet, load_rules
from matbodh_dashboard.runner.cache import ResultCache
from matbodh_dashboard.runner.queue import RQQueue
from matbodh_dashboard.runner.service import CardRunService
from matbodh_dashboard.settings import Settings, load_settings

# One preset and one cards file are served.
PRESET_FILE = "uttar-pradesh.standard-v1.yaml"
CARDS_FILE = "cards.yaml"


def load_card_config(config_dir: Path) -> tuple[MethodPreset, dict[str, CardConfig], RuleSet]:
    """The method preset, card configurations and presentation rules under config_dir."""
    return (
        load_preset(config_dir / "presets" / PRESET_FILE),
        load_cards(config_dir / "cards" / CARDS_FILE),
        load_rules(config_dir / "presentation"),
    )


def _redis(url: str) -> Any:
    from redis import Redis

    return Redis.from_url(url)


def catalogue_loader(settings: Settings) -> Callable[[], Catalogue]:
    """Load the catalogue over a short-lived, read-only ClickHouse connection."""

    def load() -> Catalogue:
        from matbodh_views.connections import create_clickhouse_client

        client = create_clickhouse_client(settings.engine_env_file)
        try:
            return load_catalogue(clickhouse_query(client))
        finally:
            client.close()

    return load


def seat_snapshot_loader(settings: Settings) -> Callable[[str, str, tuple[str, ...]], Any]:
    """Seat master snapshots over a short-lived, read-only MySQL connection.

    Only called on a label-cache miss (once per state, level and catalogue revision).
    """

    def load(state: str, level: str, attributes: tuple[str, ...]) -> Any:
        from matbodh_dash import MySQLAccess, MySQLReadAdapter
        from matbodh_views.connections import create_mysql_connection

        connection = create_mysql_connection(settings.engine_env_file)
        try:
            return MySQLAccess(MySQLReadAdapter(connection)).seat_snapshot(state, level, attributes)
        finally:
            connection.close()

    return load


def build_service_from_settings(settings: Settings) -> CardRunService:
    redis = _redis(settings.redis_url)
    cache = ResultCache(redis, settings.cache_ttl_seconds)
    queue = RQQueue(redis, cache)
    catalogue = catalogue_loader(settings)()
    preset, cards, rules = load_card_config(settings.config_dir)
    service = CardRunService(catalogue, preset, cards, rules, cache, queue, engine_version())
    service.seat_labels = MasterSeatLabels(
        seat_snapshot_loader(settings), lambda: service.catalogue.revision)
    return service


def create_production_app() -> FastAPI:
    settings = load_settings()
    return create_app(build_service_from_settings(settings), catalogue_loader(settings))
