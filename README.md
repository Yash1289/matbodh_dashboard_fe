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
rq worker engine --with-scheduler --url "$DASHBOARD_REDIS_URL"
```

- `--with-scheduler` is required: retries with backoff are scheduled jobs, and
  without a scheduler a retried job is never re-run.
- The concurrency cap on engine queries is the number of `rq worker engine`
  processes. Start with 4.
- RQ's default worker forks, which Windows does not support; on Windows add
  `--worker-class rq.worker.SimpleWorker` (one job at a time per process).
  Caveat: without `SIGALRM`, RQ enforces `job_timeout` on Windows with a timer
  thread that raises inside the job only when control returns to Python, so a
  job blocked in a database call can overrun the 300 s timeout; the engine's
  120 s ClickHouse `max_execution_time` is then the effective bound.
- Infrastructure errors retry up to 3 times (backoff 5 s, 15 s, 30 s);
  configuration and too-heavy errors never retry. An RQ job timeout (300 s,
  above the engine's 120 s query limit) counts as too heavy.
- Each worker keeps one engine `MetadataSession`; before a job it clears that
  session when the alliance epoch in Redis (bumped by
  `POST /admin/metadata/refreshed`) differs from the epoch it last saw.
- Results are cached for `DASHBOARD_CACHE_TTL_SECONDS` under a fingerprint of
  the engine config, metadata revision, engine version and alliance epoch;
  `CardRunService.refresh_metadata` bumps the epoch and so invalidates them.
- Each job logs one JSON line (logger `matbodh_dashboard.runner.service`) with
  fingerprint, card, part, state, timings, row count, cache hit, error kind and
  versions; no respondent data.

## Live smoke check (State Pulse scoreboard)

`scripts/smoke_state_pulse.py` runs the `pulse.party_scoreboard` card through
the real engine and `CardRunService` synchronously (`InlineQueue`) and prints
per-job timings, the scoreboard rows and any errors.

Prerequisites:

- The setup above, including the `dev` extra (the script keeps results in an
  in-process `fakeredis`, so no Redis server is needed).
- `ENGINE_ENV_FILE` pointing at the engine env file (read-only MySQL and
  ClickHouse credentials). Run it only with the product owner's go-ahead.

```bash
.venv/Scripts/python.exe scripts/smoke_state_pulse.py --state "Uttar Pradesh" --rounds "2027 VS CAPI R1" "2027 VS CAPI R2"
```

- It is read-only: the catalogue query and every engine job use read-only
  connections, and nothing is written to any database. Output is aggregates
  only. It lives outside `tests/`, so pytest never collects it.
- It uses the Uttar Pradesh standard-v1 preset and the pulse templates from
  `config/`, at AC level.
- With two or more `--rounds`, the first entry is the compare round and the
  latest is the anchor; a single round runs without a compare round (no Δ).
  An invalid selection prints `INVALID:` lines and exits with code 2.
- Timings are for information, not acceptance thresholds.
- Expected (Appendix A of the spec): four jobs (`vote`, `parties`, `seats_ac`,
  `seats_pc`) and no errors; rows NDA, SP+, BSP, Other, plus JDL as an
  "of which" row flagged `within_other` (it led 2 AC seats in R1). JDL's vote
  cell is its survey share from the ungrouped `parties` job, already counted
  inside Other, so the vote column is not additive across such rows. Seat
  counts AC NDA 243 to 154, SP+ 158 to 249; PC NDA 49 to 26, SP+ 31 to 54.
- Exit code 0 only when the run state is `done`.

## Docs

- Spec: [docs/specs/2026-11-08-dashboard-design.md](docs/specs/2026-11-08-dashboard-design.md)
- Plan: [docs/plans/2026-11-09-phase-1a-backend.md](docs/plans/2026-11-09-phase-1a-backend.md)
