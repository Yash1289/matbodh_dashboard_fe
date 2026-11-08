"""RQ worker entry point: ``rq worker engine`` runs ``execute`` per job.

Each worker process owns one engine runtime (and its read-only connections),
built lazily on the first job. The concurrency cap is the number of worker
processes.
"""

from __future__ import annotations

from matbodh_dashboard.runner.cache import ResultCache
from matbodh_dashboard.runner.engine import EngineRunner, build_runtime
from matbodh_dashboard.runner.queue import Runner, attempt

_runner: EngineRunner | None = None
_cache: ResultCache | None = None


def _resources() -> tuple[Runner, ResultCache]:
    global _runner, _cache
    if _runner is None or _cache is None:
        from redis import Redis

        from matbodh_dashboard.settings import load_settings

        settings = load_settings()
        _cache = ResultCache(Redis.from_url(settings.redis_url), settings.cache_ttl_seconds)
        _runner = EngineRunner(build_runtime(settings.engine_env_file))
    return _runner, _cache


def _retries_left() -> int:
    from rq import get_current_job

    job = get_current_job()
    return (job.retries_left or 0) if job is not None else 0


def execute(fp: str, config: dict) -> None:
    """Run one config; store the result or the classified error.

    An infrastructure error with retries left is raised so RQ retries the job
    with backoff; any other error is stored and the job ends normally, so it is
    never retried.
    """
    runner, cache = _resources()
    error = attempt(runner, cache, fp, config)
    if error is None:
        return
    if error.kind == "infrastructure" and _retries_left() > 0:
        raise error
    cache.put_error(fp, error)
