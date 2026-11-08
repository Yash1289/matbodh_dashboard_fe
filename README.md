# matbodh-dashboard

Python backend for the MatBodh survey-analytics dashboard. It wraps the
sibling engine repo `../MatBodh-Dash` (package `matbodh-survey-backend`).

## Setup

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -e "../MatBodh-Dash[host]"
.venv/Scripts/python.exe -m pip install -e ".[dev]"
```

Required environment: `ENGINE_ENV_FILE` (path to the engine env file).
Optional: `DASHBOARD_REDIS_URL`, `DASHBOARD_CACHE_TTL_SECONDS`, `DASHBOARD_CONFIG_DIR`.

## Tests

```bash
.venv/Scripts/python.exe -m pytest
```

## Docs

- Spec: [docs/specs/2026-11-08-dashboard-design.md](docs/specs/2026-11-08-dashboard-design.md)
- Plan: [docs/plans/2026-11-09-phase-1a-backend.md](docs/plans/2026-11-09-phase-1a-backend.md)
