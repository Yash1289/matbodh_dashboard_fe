from pathlib import Path

import pytest

from matbodh_dashboard import engine_version
from matbodh_dashboard.settings import load_settings


def test_engine_importable_and_version():
    import matbodh_dash  # noqa: F401

    assert engine_version() == "0.8.0"


def test_settings_defaults(monkeypatch):
    monkeypatch.setenv("ENGINE_ENV_FILE", "engine.env")
    for name in ("DASHBOARD_REDIS_URL", "DASHBOARD_CACHE_TTL_SECONDS", "DASHBOARD_CONFIG_DIR"):
        monkeypatch.delenv(name, raising=False)
    settings = load_settings()
    assert settings.engine_env_file == Path("engine.env")
    assert settings.cache_ttl_seconds == 86400
    assert settings.redis_url == "redis://localhost:6379/0"
    assert settings.config_dir.name == "config"


def test_settings_require_env_file(monkeypatch):
    monkeypatch.delenv("ENGINE_ENV_FILE", raising=False)
    with pytest.raises(ValueError, match="ENGINE_ENV_FILE is required"):
        load_settings()
