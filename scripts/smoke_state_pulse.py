"""Manual, read-only smoke check: run the State Pulse scoreboard through the real engine.

Not collected by pytest (it lives outside tests/). Run it only with the product
owner's go-ahead; it opens read-only MySQL and ClickHouse connections taken from
ENGINE_ENV_FILE. Output is aggregates only: timings, scoreboard rows, errors.
The preset and templates are the Uttar Pradesh standard-v1 files in config/ and
the level is AC. Results are cached in an in-process fakeredis, so no Redis server is needed.

    python scripts/smoke_state_pulse.py --state "Uttar Pradesh" \
        --rounds "2027 VS CAPI R1" "2027 VS CAPI R2"
"""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Sequence

from matbodh_dashboard import engine_version
from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import load_preset
from matbodh_dashboard.registry import load_rules
from matbodh_dashboard.runner.cache import ResultCache
from matbodh_dashboard.runner.queue import InlineQueue, Runner
from matbodh_dashboard.runner.service import CardRunService, CardRunStatus
from matbodh_dashboard.settings import Settings, load_settings
from matbodh_dashboard.templates import load_templates

CARD_ID = "pulse.party_scoreboard"
PRESET_FILE = "uttar-pradesh.standard-v1.yaml"
TEMPLATES_FILE = "pulse.yaml"
POLL_LIMIT = 100


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only State Pulse scoreboard smoke check against the real engine.",
    )
    parser.add_argument("--state", required=True, help='State name, e.g. "Uttar Pradesh"')
    parser.add_argument("--rounds", nargs="+", required=True, metavar="ROUND",
                        help="Round base names, oldest first; the first is the compare round")
    return parser.parse_args(argv)


def build_service(settings: Settings, catalogue: Catalogue, runner: Runner) -> CardRunService:
    """Wire the card run service with an in-process cache and a synchronous queue."""
    import fakeredis

    cache = ResultCache(fakeredis.FakeStrictRedis(), settings.cache_ttl_seconds)
    queue = InlineQueue(runner, cache)
    config = settings.config_dir
    return CardRunService(
        catalogue,
        load_preset(config / "presets" / PRESET_FILE),
        load_templates(config / "templates" / TEMPLATES_FILE),
        load_rules(config / "presentation"),
        cache,
        queue,
        engine_version(),
    )


def run_card(service: CardRunService, ctx: StateContext) -> tuple[str, CardRunStatus, float]:
    """Start the card and poll until it settles; returns run id, status and wall seconds."""
    began = time.perf_counter()
    run_id = service.start(CARD_ID, ctx)
    status = service.status(run_id)
    for _ in range(POLL_LIMIT):
        if status.state != "running":
            break
        status = service.status(run_id)
    return run_id, status, time.perf_counter() - began


def report(service: CardRunService, run_id: str, status: CardRunStatus,
           seconds: float) -> list[str]:
    """Aggregate-only report lines: state, per-job timings, scoreboard, errors."""
    lines = [f"state={status.state} jobs={status.done}/{status.total} wall={seconds:.2f}s"]
    if status.state == "running":
        lines.append(f"STOPPED: run still running after {POLL_LIMIT} polls; result is incomplete")
    for job in service.job_timings(run_id):
        lines.append(f"  job part={job['part']} state={job['state']} "
                     f"engine_s={_secs(job['engine_s'])} queue_wait_s={_secs(job['queue_wait_s'])}")
    if status.result is not None:
        lines.append("scoreboard (series: vote | seats_ac | seats_pc | gender_gap):")
        for row in status.result["scoreboard"]:
            cells = " | ".join(_fmt(row[k]) for k in ("vote", "seats_ac", "seats_pc", "gender_gap"))
            lines.append(f"  {row['series']}: {cells}")
        if status.result["unavailable"]:
            lines.append(f"unavailable: {status.result['unavailable']}")
    for part, error in sorted(status.errors.items()):
        lines.append(f"ERROR part={part} kind={error['kind']}: {error['message']}")
    return lines


def _secs(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f}"


def _fmt(cell: dict | None) -> str:
    if cell is None:
        return "-"
    delta = cell.get("delta")
    return f"{cell['value']}" + (f" ({delta:+})" if delta is not None else "")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    settings = load_settings()
    from matbodh_dashboard.catalogue.store import clickhouse_query, load_catalogue
    from matbodh_dashboard.runner.engine import EngineRunner, build_runtime
    from matbodh_views.connections import create_clickhouse_client

    client = create_clickhouse_client(settings.engine_env_file)
    try:
        catalogue = load_catalogue(clickhouse_query(client))
    finally:
        client.close()
    runner = EngineRunner(build_runtime(settings.engine_env_file))
    service = build_service(settings, catalogue, runner)
    ctx = StateContext(state=args.state, level="ac", rounds=list(args.rounds),
                       compare_round=args.rounds[0])
    status, seconds = run_card(service, ctx)
    print("\n".join(report(service, status, seconds)))
    return 0 if status.state == "done" else 1


if __name__ == "__main__":
    sys.exit(main())
