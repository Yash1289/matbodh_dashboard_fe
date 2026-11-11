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

## API

```bash
uvicorn matbodh_dashboard.bootstrap:create_production_app --factory
```

`matbodh_dashboard.bootstrap` is the composition root: settings, Redis
(`DASHBOARD_REDIS_URL`), the result cache, the RQ queue, the survey catalogue
(loaded over a short-lived read-only ClickHouse connection from
`ENGINE_ENV_FILE`), the card run service and the FastAPI app. The API never
runs engine queries itself; workers do.

## Read-only database users

The MySQL and ClickHouse users in the engine env file must be read-only at the
database. The dashboard sets ClickHouse `readonly=1` only on its own catalogue
query; engine jobs run through the engine's adapters, which this repository does
not restrict, so the database grants are the safeguard.

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

## Live smoke check (one card)

`scripts/smoke_card.py` runs one card from `config/cards/cards.yaml` through the real
engine and `CardRunService` synchronously (`InlineQueue`) and prints the payload shape
(family, mode, cuts, columns), per-job timings, per-cut row, cell and delta counts, and
any errors. A grid card compiles to a single engine job, `grid`; a ranking card is one
job (`rank`), or one job per round in a trend (`rank:<obs_id>`). For a ranking card the
report prints entity, rank, absent-slot and group counts, and the run also exercises the
real seat-name lookup from the MySQL master.

Prerequisites:

- The setup above, including the `dev` extra (the script keeps results in an
  in-process `fakeredis`, so no Redis server is needed).
- `ENGINE_ENV_FILE` pointing at the engine env file (read-only MySQL and
  ClickHouse credentials). Run it only with the product owner's go-ahead.

```bash
.venv/Scripts/python.exe scripts/smoke_card.py --card opinion.leaders --state "Uttar Pradesh" --rounds "2027 VS CAPI R1" "2027 VS CAPI R2"
```

- It is read-only: the catalogue query and every engine job use read-only
  connections, and nothing is written to any database. Output is aggregates
  only. It lives outside `tests/`, so pytest never collects it.
- It uses the Uttar Pradesh standard-v1 preset and the cards from `config/`, at AC level.
- With two or more `--rounds`, the first entry is the compare round and the
  latest is the anchor; a single round runs without a compare round.
  An invalid selection prints `INVALID:` lines and exits with code 2.
- Timings are for information, not acceptance thresholds. This check has not been run
  against a live database as part of the card foundation work.
- Exit code 0 only when the run state is `done`.

## Cards

The card foundation replaces the State Pulse page. One card is one `CardConfig` in
`config/cards/cards.yaml` (family, scenarios, cuts, filters, comparison). The card
compiles to one engine job (`matbodh_dashboard/cards/compile.py`), runs through the
existing queue, cache and fingerprint, and `matbodh_dashboard/cards/translate.py`
turns the engine result into a typed long-format `GridPayload`. Each family
(`distribution`, `opinion`, `gender_differential`) is a `FamilySpec` in
`matbodh_dashboard/cards/families/`, and `matbodh_dashboard/cards/field_maps/*.yaml`
maps every engine result key to a role; a test fails if the engine returns an unmapped key.

```bash
python scripts/export_card_fixtures.py   # real-engine payloads for the frontend tests
python scripts/measure_payload.py        # payload sizes for the two largest samples
```

`GET /cards` lists the cards with each family's lenses and capabilities, and the browser
renders them with `web/src/cards/CardShell.tsx` on the cards page (`/`).

### Ranking cards

Two more families, `seat_ranking` (AC or PC seats) and `demographic_ranking` (groups of
a profiling field inside a partition), show engine rankings; the spec is
`docs/specs/2026-11-11-ranking-cards-design.md` and the plan `docs/plans/2026-11-11-ranking-cards.md`.
A card carries a `rank` block (`metric`, `party_id`, `level`, `partition_by`, `top_k`);
demographic ranking requires `top_k` 1 to 5 (`TOP_K_MAX` in `cards/config.py`), seat
ranking has no cap. A standalone or compare card is one engine job; a trend runs one job
per round (`matbodh_dashboard/cards/ranking/compile.py`) and
`cards/ranking/translate.py` merges the results into a long-format `RankedPayload`: the
anchor round decides the rows, later rounds are looked up, and a missing slot is a dash
with a reason (`outside_top_k`, `not_ranked`, `round_failed`), never a zero. A failed
non-anchor round gives a partial card; a failed anchor round fails it. The engine owns
every rank and number.

Seat names are not in engine rows. `cards/ranking/labels.py` looks them up from the
master (read-only MySQL, cached per state, level and catalogue revision) unless the
engine row carries a name itself; a failed lookup costs only the names. The browser
renders ranking cards with `web/src/cards/ranking/RankingCard.tsx`.

Ranking fixtures for the frontend come from the real ranking samples; the earlier round
of the trend fixture is a synthetic variant (only R2 ranking samples exist) and its
contract says `synthetic_later_round`.

Measured payload sizes (`measure_payload.py`, standalone mode, first scenario, latest
observation; "rows" are payload rows, not engine rows):

| Sample | Family | Rows | JSON | Gzipped |
|---|---|---|---|---|
| `result_ac_1.json` | distribution | 2016 | 11.44 MB | 0.79 MB |
| `result_gd_complex.json` | gender_differential | 2032 | 8.08 MB | 0.96 MB |

Both are under the spec's 2 MB gzipped threshold, so the long-format encoding stays. The
raw JSON is large, so parse time on a slow device is the thing to watch.

## Docs

- Spec: [docs/specs/2026-11-08-dashboard-design.md](docs/specs/2026-11-08-dashboard-design.md)
- Plan: [docs/plans/2026-11-09-phase-1a-backend.md](docs/plans/2026-11-09-phase-1a-backend.md)
- Card foundation spec: [docs/specs/2026-11-10-card-foundation-and-grid-family-design.md](docs/specs/2026-11-10-card-foundation-and-grid-family-design.md)
- Card foundation plan: [docs/plans/2026-11-10-card-foundation-and-grid-family.md](docs/plans/2026-11-10-card-foundation-and-grid-family.md)

## Frontend

The React/TypeScript dashboard lives in `web/`.

```
cd web && npm install
npm run dev     # Vite dev server; proxies /api to the API on 127.0.0.1:8000
npm test        # Vitest
npm run build   # type-check and production build
npm run e2e     # Playwright journey, API mocked from the test fixtures
```

The e2e test builds the app, serves it on port 4173 and drives the installed
Google Chrome (`channel: "chrome"`), so Chrome must be installed. As an
alternative, run `npx playwright install chromium` once and drop the `channel`
line from `web/playwright.config.ts`. The e2e never touches a real API or
database. Port 4173 must be free: the config always builds and starts its own
preview (it never reuses a running server, which could serve a stale build).

### Manual live check

Live runs read the production databases (read-only) and need the product
owner's go-ahead every time. Nothing in the automated suites runs against them.

1. Network/VPN up; confirm the ClickHouse port is reachable:
   `bash -c 'cat < /dev/null > /dev/tcp/<host>/8123'`.
2. Redis running.
3. API: `uvicorn matbodh_dashboard.bootstrap:create_production_app --factory --port 8000`.
4. One worker: `rq worker engine --with-scheduler --worker-class rq.worker.SimpleWorker --url "$DASHBOARD_REDIS_URL"`.
5. `cd web && npm run dev`, open the printed URL.
6. Choose Uttar Pradesh, level AC, tick 2027 VS CAPI R1 and R2, compare R1, Apply.
7. The cards page lists the cards from `config/cards/cards.yaml`. For each, check that the lens,
   cut, sort, transpose and format controls change the display without a network request,
   that a missing value shows `—` with a reason, and that the numbers match the engine
   result for the same selection (compare against `scripts/smoke_card.py` output).
