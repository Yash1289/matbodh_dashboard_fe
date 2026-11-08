"""Environment-driven settings for the dashboard backend."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    engine_env_file: Path
    redis_url: str
    cache_ttl_seconds: int  # placeholder for open decision section 20.6
    config_dir: Path


def load_settings() -> Settings:
    env_file = os.environ.get("ENGINE_ENV_FILE")
    if not env_file:
        raise ValueError("ENGINE_ENV_FILE is required")
    ttl_raw = os.environ.get("DASHBOARD_CACHE_TTL_SECONDS", "86400")
    try:
        ttl = int(ttl_raw)
    except ValueError:
        raise ValueError(
            f"DASHBOARD_CACHE_TTL_SECONDS must be an integer, got {ttl_raw!r}"
        ) from None
    return Settings(
        engine_env_file=Path(env_file),
        redis_url=os.environ.get("DASHBOARD_REDIS_URL", "redis://localhost:6379/0"),
        cache_ttl_seconds=ttl,
        config_dir=Path(os.environ.get("DASHBOARD_CONFIG_DIR", _REPO_ROOT / "config")),
    )
