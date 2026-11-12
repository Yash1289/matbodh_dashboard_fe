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
- Benchmark cards take `--reference none|compare|election:YEAR:TYPE` and also use the real alliance
  lookup; the report lists table sizes, Other rows, dashes and the per-group vote-share sums.

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

Live check (2026-11-11, Uttar Pradesh, R1 and R2, read-only, product-owner approved): the four
seeded cards all ended `done` with `party_id: NDA` accepted by the engine. AC PM net
satisfaction 403 seats (4.7 s engine); NDA support by zone 403 seats in 15 partitions
(3.5 s); PC PM net satisfaction from the AC survey 80 PCs (6.8 s); castes by AC support
1213 ranks over 403 ACs, at most 3 per AC (3.1 s). A trend over R1 and R2 ran 2 jobs
(806 ranks, no absent slots) and a compare ran 1 job (29.5 s), both with all 403 seat
names resolved from the master and no zero-valued rank. Timings are information only;
other states and rounds are unverified.

Ranking fixtures for the frontend come from the real ranking samples; the earlier round
of the trend fixture is a synthetic variant (only R2 ranking samples exist) and its
contract says `synthetic_later_round`.

### Benchmark cards

The `seat_benchmark` family compares the anchor survey round with nothing, another survey round
or an actual election, seat by seat and by group (spec `docs/specs/2026-11-12-benchmark-cards-design.md`,
plan `docs/plans/2026-11-12-benchmark-cards.md`). One card is one engine job
(`cards/benchmark/compile.py`); the payload (`cards/benchmark/payload.py`, built by
`translate.py`) carries four tables, Comparison, Seat summary, Margin buckets and Flips, and
`web/src/cards/benchmark/BenchmarkCard.tsx` lets the user choose one. The chooser is display-only;
the reference picker (none, the context's compare round, or an election from `config/elections.yaml`)
is the only control that re-runs the engine. The engine owns every number.

- **Major parties come from the alliance table**, per run and cached for the session
  (`cards/benchmark/parties.py`); nothing is hardcoded and `preset.keep` is not used. The displayed
  list is the union of both endpoints' mappings. Every other party, and NOTA, is the engine's
  single **Other** row (this needs the engine's Other-in-summaries change, `MatBodh-Dash` cb0af39).
  A party missing from one endpoint's mapping (for example `INDI`, mapped for 2022 VS but not for the
  survey) is a dash with a reason on that side, never the engine's zero.
- **A copied card that changes only `view`** shares one engine run: the engine config has no card
  id and no view, so the fingerprint is identical (`config/cards/cards.yaml` has two such cards).
- Election endpoints use `passthrough: true`, so unmapped historical parties compete individually.
  An election with no alliance context, or a focal party outside the majors, makes the card
  unavailable with a reason before any run.
- `seat_results` and `coverage` are not in the card payload yet (sub-project 5, the investigation
  drawer, needs them). Deferred seat-level Other items are listed in spec section 12.1.

Live check (2026-11-12, Uttar Pradesh, R1 and R2, read-only, through `scripts/smoke_card.py`, VPN,
product-owner invited): `benchmark.up_zone_nda` ended `done` with 1 job for each reference. Against
the 2022 VS election: 50.8 s, parties BSP, INDI, NDA, SP+, 32 Other rows, 32 dashes (INDI on the survey
side), named parties plus Other summing to 100.0000% in all 32 endpoint-groups. Against the compare
round R1: 39.9 s, no dashes, 32 groups all 100.0000%. With no reference: 13.6 s, only the Seat summary
and Margin buckets tables, 16 groups all 100.0000%. Timings are information only. Not verified: the
browser against a live API, PC level, other states or elections, and the engine's NOTA share of Other.

### Relationship cards

The `relationship` family shows how respondents answered two party questions of the same survey
row, for example the recalled vote (`vs_past`) against the current choice (`vs_voting_intention`)
(spec `docs/specs/2026-11-12-relationship-cards-design.md`, plan `docs/plans/2026-11-12-relationship-cards.md`).
One card is one engine job (`cards/relationship/compile.py`, base joint weight only); the payload
(`cards/relationship/payload.py`, built by `translate.py`) feeds two display tables chosen on the card
(`web/src/cards/relationship/RelationshipCard.tsx`): **Flow summary** (net flow, retention, gained and lost
population share, acquisition; with a focal party) and **Matrix** (origin to destination pairs of the major
parties: origin, destination and joint share, size of impact). Every chip is display-only; the engine owns every number.

- **Major parties only.** They come from the alliance table (the benchmark's provider). The focal party in the
  card config must be one of them, otherwise the card is unavailable with a reason. Shares keep the engine's
  bases, which include smaller parties, so a matrix row does not add to 100 over the major destinations only.
- **A major-by-major cell the engine returned no row for** is a dash reading "no respondents moved"; it is never a zero.
- **Gender `Other` is never shown**, in any table: `config/presentation/global.yaml` has
  `field: gender, hidden: [Other]`, applied by the presentation rules (the grid cards' single gender cut and the
  relationship translator both read it).
- **No cross-round comparison.** Each round is its own matrix (`cross_round_pairing: false`); a trend shows each
  round's values side by side as pipes, never deltas.
- Explicit party options are not used: they close the engine's answer set and fail in ClickHouse with a division by
  zero (spec section 10).
- Scenario-donor joint weights and `weights.external` are deferred (spec section 12).

Live check (2026-11-12, Uttar Pradesh, R1 and R2, read-only, through `scripts/smoke_card.py`, VPN, product-owner approved): both starter cards ended `done` with 1 job in about 8 s; majors NDA, SP+, BSP; 3 groups (overall, Female, Male), 54 cells, no absent cell; the four flows add to the paired base in every summary. Not verified: PC level, cohort filters, a low-base threshold. Details in spec section 10.

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
