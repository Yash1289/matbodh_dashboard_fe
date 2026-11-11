"""Manual, read-only smoke check: run one dashboard card through the real engine.

Not collected by pytest (it lives outside tests/). Run it only with the product
owner's go-ahead; it opens read-only MySQL and ClickHouse connections taken from
ENGINE_ENV_FILE. Output is aggregates only: timings, row and cell counts, errors.
The preset and cards are the Uttar Pradesh standard-v1 files in config/ and the
level is AC. Results are cached in an in-process fakeredis, so no Redis server is needed.

    python scripts/smoke_card.py --card opinion.leaders --state "Uttar Pradesh" \
        --rounds "2027 VS CAPI R1" "2027 VS CAPI R2"
"""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Sequence

from matbodh_dashboard import engine_version
from matbodh_dashboard.bootstrap import alliance_session_factory, load_card_config, seat_snapshot_loader
from matbodh_dashboard.capability import validate_context
from matbodh_dashboard.cards.benchmark.parties import AllianceMajorParties, load_elections
from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
from matbodh_dashboard.cards.ranking.labels import MasterSeatLabels
from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.runner.cache import ResultCache
from matbodh_dashboard.runner.queue import InlineQueue, Runner
from matbodh_dashboard.runner.service import CardRunService, CardRunStatus
from matbodh_dashboard.settings import Settings, load_settings

POLL_LIMIT = 100


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only card smoke check against the real engine.",
    )
    parser.add_argument("--card", required=True, help="Card id from config/cards/cards.yaml")
    parser.add_argument("--state", required=True, help='State name, e.g. "Uttar Pradesh"')
    parser.add_argument("--rounds", nargs="+", required=True, metavar="ROUND",
                        help="Round base names, oldest first; with two or more, the "
                             "first is the compare round")
    parser.add_argument("--reference", default=None, metavar="REF",
                        help="Benchmark cards only: none, compare or election:YEAR:TYPE "
                             "(e.g. election:2022:VS). Default: the compare round when there is one")
    return parser.parse_args(argv)


def parse_reference(text: str | None) -> BenchmarkReference | None:
    if text is None:
        return None
    if text.startswith("election:"):
        _, year, election_type = text.split(":")
        return BenchmarkReference(kind="election", year=int(year), election_type=election_type)
    return BenchmarkReference(kind=text)


def build_context(state: str, rounds: Sequence[str]) -> StateContext:
    """AC-level context; the first round is the compare round when there are two or more."""
    return StateContext(state=state, level="ac", rounds=list(rounds),
                        compare_round=rounds[0] if len(rounds) > 1 else None)


def build_service(settings: Settings, catalogue: Catalogue, runner: Runner) -> CardRunService:
    """Wire the card run service with an in-process cache and a synchronous queue."""
    import fakeredis

    cache = ResultCache(fakeredis.FakeStrictRedis(), settings.cache_ttl_seconds)
    queue = InlineQueue(runner, cache)
    preset, cards, rules = load_card_config(settings.config_dir)
    service = CardRunService(catalogue, preset, cards, rules, cache, queue, engine_version())
    service.elections = load_elections(settings.config_dir / "elections.yaml")
    return service


def run_card(service: CardRunService, card_id: str, ctx: StateContext,
             reference: BenchmarkReference | None = None) -> tuple[str, CardRunStatus, float]:
    """Start the card and poll until it settles; returns run id, status and wall seconds."""
    began = time.perf_counter()
    run_id = service.start(card_id, ctx, reference)
    status = service.status(run_id)
    for _ in range(POLL_LIMIT):
        if status.state != "running":
            break
        status = service.status(run_id)
    return run_id, status, time.perf_counter() - began


def report(service: CardRunService, run_id: str, status: CardRunStatus,
           seconds: float) -> list[str]:
    """Aggregate-only report lines: state, payload shape, per-job timings, errors."""
    lines = [f"state={status.state} jobs={status.done}/{status.total} wall={seconds:.2f}s"]
    result = status.result
    if result is not None and result.get("kind") == "benchmark":
        return lines + _benchmark_lines(service, run_id, result, status)
    ranked = result is not None and result.get("kind") == "ranked"
    if ranked:
        lines.append(f"family={result['family']} mode={result['mode']} "
                     f"entities={len(result['entities'])} ranks={len(result['ranks'])} "
                     f"absent={len(result['absent'])} groups={len(result['groups'])}")
    elif result is not None:
        lines.append(f"family={result['family']} mode={result['mode']} "
                     f"cuts={len(result['cuts'])} columns={len(result['columns'])} "
                     f"hidden={result['hidden_count']}")
    if status.state == "running":
        lines.append(f"STOPPED: run still running after {POLL_LIMIT} polls; result is incomplete")
    for job in service.job_timings(run_id):
        lines.append(f"  job part={job['part']} state={job['state']} "
                     f"engine_s={_secs(job['engine_s'])} queue_wait_s={_secs(job['queue_wait_s'])}")
    if result is not None:
        for cut in () if ranked else result["cuts"]:
            lines.append(f"  cut {cut['id']}: rows={len(cut['rows'])} cells={len(cut['cells'])} "
                         f"deltas={len(cut['deltas'])}")
        if result["unavailable"]:
            lines.append(f"unavailable: {result['unavailable']}")
        if result["not_asked"]:
            lines.append(f"not asked: {result['not_asked']}")
    for part, error in sorted(status.errors.items()):
        lines.append(f"ERROR part={part} kind={error['kind']}: {error['message']}")
    return lines


def _benchmark_lines(service: CardRunService, run_id: str, result: dict,
                     status: CardRunStatus) -> list[str]:
    """Aggregate-only benchmark report: table sizes, Other rows, dashes and the per-group sums."""
    other = result["other_label"]
    summaries = result["summaries"]
    dashes = (sum(r["absent"] is not None for r in summaries)
              + sum(bool(r["absent_sides"]) for r in result["comparisons"]))
    lines = [f"family={result['family']} reference={result['reference']['label'] or result['reference']['kind']} "
             f"tables={result['tables_available']} default={result['default_table']} "
             f"comparisons={len(result['comparisons'])} summaries={len(summaries)} "
             f"margin_buckets={len(result['margin_buckets'])} flips={len(result['flips'])} "
             f"parties={result['parties']} other_rows={sum(r['party'] == other for r in summaries)} "
             f"dashes={dashes}"]
    sums: dict[tuple, float] = {}
    for r in summaries:
        if r["vote_share"] is not None:
            key = (r["endpoint"], r["group"]["set_id"], tuple(sorted(r["group"]["dimensions"].items())))
            sums[key] = sums.get(key, 0.0) + r["vote_share"]
    if sums:
        lines.append(f"sums: groups={len(sums)} min={min(sums.values()):.4f} max={max(sums.values()):.4f}")
    for job in service.job_timings(run_id):
        lines.append(f"  job part={job['part']} state={job['state']} "
                     f"engine_s={_secs(job['engine_s'])} queue_wait_s={_secs(job['queue_wait_s'])}")
    if result["unavailable"]:
        lines.append(f"unavailable: {result['unavailable']}")
    for part, error in sorted(status.errors.items()):
        lines.append(f"ERROR part={part} kind={error['kind']}: {error['message']}")
    return lines


def _secs(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f}"


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    settings = load_settings()
    _, cards, _ = load_card_config(settings.config_dir)
    if args.card not in cards:
        print(f"INVALID: unknown card {args.card!r}; known: {', '.join(sorted(cards))}")
        return 2
    from matbodh_dashboard.catalogue.store import clickhouse_query, load_catalogue
    from matbodh_dashboard.runner.engine import EngineRunner, build_runtime
    from matbodh_views.connections import create_clickhouse_client

    client = create_clickhouse_client(settings.engine_env_file)
    try:
        catalogue = load_catalogue(clickhouse_query(client))
    finally:
        client.close()
    ctx = build_context(args.state, args.rounds)
    errors = validate_context(ctx, catalogue)
    if errors:  # before any engine connection is opened
        for error in errors:
            print(f"INVALID: {error}")
        return 2
    runner = EngineRunner(build_runtime(settings.engine_env_file))
    service = build_service(settings, catalogue, runner)
    # The real master lookup, so a ranking card's seat names are part of the live check.
    service.seat_labels = MasterSeatLabels(
        seat_snapshot_loader(settings), lambda: service.catalogue.revision)
    # The real alliance lookup, so a benchmark card's major parties are part of the live check.
    service.major_parties = AllianceMajorParties(
        lambda: alliance_session_factory(settings), service.cache.alliance_epoch)
    run_id, status, seconds = run_card(service, args.card, ctx, parse_reference(args.reference))
    print("\n".join(report(service, run_id, status, seconds)))
    return 0 if status.state == "done" else 1


if __name__ == "__main__":
    sys.exit(main())
