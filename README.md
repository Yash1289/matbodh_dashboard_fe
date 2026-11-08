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

## Engine workers

Card runs queue engine jobs in Redis (`DASHBOARD_REDIS_URL`); workers execute
them with read-only connections from `ENGINE_ENV_FILE`:

```bash
rq worker engine --url "$DASHBOARD_REDIS_URL"
```

- The concurrency cap on engine queries is the number of `rq worker engine`
  processes. Start with 4.
- RQ's default worker forks, which Windows does not support; on Windows add
  `--worker-class rq.worker.SimpleWorker` (one job at a time per process).
- Infrastructure errors retry up to 3 times (backoff 5 s, 15 s, 30 s);
  configuration and too-heavy errors never retry.
- Results are cached for `DASHBOARD_CACHE_TTL_SECONDS` under a fingerprint of
  the engine config, metadata revision, engine version and alliance epoch;
  `CardRunService.refresh_metadata` bumps the epoch and so invalidates them.
- Each job logs one JSON line (logger `matbodh_dashboard.runner.service`) with
  fingerprint, card, part, state, timings, row count, cache hit, error kind and
  versions; no respondent data.

## Docs

- Spec: [docs/specs/2026-11-08-dashboard-design.md](docs/specs/2026-11-08-dashboard-design.md)
- Plan: [docs/plans/2026-11-09-phase-1a-backend.md](docs/plans/2026-11-09-phase-1a-backend.md)
