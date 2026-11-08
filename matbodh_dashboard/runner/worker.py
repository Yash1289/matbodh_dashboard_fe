"""RQ worker entry point: ``rq worker engine --with-scheduler`` runs ``execute`` per job.

Each worker process owns one engine runtime (and its read-only connections and
MetadataSession), built lazily on the first job. The concurrency cap is the
number of worker processes. A metadata refresh bumps the alliance epoch in
Redis; before each job the worker clears its MetadataSession when the epoch
differs from the one it last saw.
"""

from __future__ import annotations

import logging
from typing import Any

from matbodh_dashboard.runner.cache import ResultCache
from matbodh_dashboard.runner.engine import EngineError, EngineRunner, build_runtime
from matbodh_dashboard.runner.queue import JOB_TIMEOUT_SECONDS, Runner, attempt

log = logging.getLogger(__name__)

_runner: EngineRunner | None = None
_cache: ResultCache | None = None
_session: Any = None  # the runtime's engine MetadataSession
_seen_epoch: int | None = None


def _resources() -> tuple[Runner, ResultCache, Any]:
    global _runner, _cache, _session
    if _runner is None or _cache is None or _session is None:
        from redis import Redis

        from matbodh_dashboard import settings as settings_module

        settings = settings_module.load_settings()
        _cache = ResultCache(Redis.from_url(settings.redis_url), settings.cache_ttl_seconds)
        runtime = build_runtime(settings.engine_env_file)
        _session = runtime.session  # NamedSurveyRuntime exposes its MetadataSession
        _runner = EngineRunner(runtime)
    return _runner, _cache, _session


def _sync_metadata(cache: ResultCache, session: Any) -> None:
    """Clear cached engine metadata once per alliance-epoch change."""
    global _seen_epoch
    epoch = cache.alliance_epoch()
    if _seen_epoch is not None and epoch != _seen_epoch:
        session.clear()
    _seen_epoch = epoch


def _retries_left() -> int:
    from rq import get_current_job

    job = get_current_job()
    return (job.retries_left or 0) if job is not None else 0


class _TimeoutAsTooHeavy:
    """An RQ job timeout means the cut is too heavy; it must not be retried."""

    def __init__(self, runner: Runner) -> None:
        self._runner = runner

    def run(self, config: dict) -> dict:
        from rq.timeouts import JobTimeoutException

        try:
            return self._runner.run(config)
        except JobTimeoutException as exc:
            raise _too_heavy() from exc
        except EngineError as err:  # EngineRunner wraps the timeout as its cause
            if isinstance(err.__cause__, JobTimeoutException):
                raise _too_heavy() from err.__cause__
            raise


def _too_heavy() -> EngineError:
    return EngineError("too_heavy", f"engine job exceeded {JOB_TIMEOUT_SECONDS} s",
                       "JobTimeoutException")


def execute(fp: str, config: dict) -> None:
    """Run one config; store the result or the classified error.

    An infrastructure error with retries left is raised so RQ retries the job
    with backoff; any other error is stored and the job ends normally, so it is
    never retried.
    """
    runner, cache, session = _resources()
    _sync_metadata(cache, session)
    error = attempt(_TimeoutAsTooHeavy(runner), cache, fp, config)
    if error is None:
        return
    # Type and fingerprint only: driver messages can carry connection details.
    log.warning("engine job failed: fingerprint=%s kind=%s type=%s",
                fp, error.kind, error.error_type)
    if error.kind == "infrastructure" and _retries_left() > 0:
        # A fresh exception without the driver error chained: RQ logs it.
        raise EngineError(error.kind, error.message, error.error_type) from None
    cache.put_error(fp, error)
