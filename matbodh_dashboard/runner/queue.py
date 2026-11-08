"""Job queues that execute engine configs and store outcomes in the result cache.

Infrastructure errors retry up to three times with backoff; ``config`` and
``too_heavy`` errors never retry. A queue never runs a fingerprint whose result
is cached, and never enqueues a fingerprint that is already in flight.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from typing import Any, Literal, Protocol

from matbodh_dashboard.runner.cache import ResultCache
from matbodh_dashboard.runner.engine import EngineError, classify

JobState = Literal["queued", "running", "done", "failed"]

RETRY_INTERVALS: tuple[int, ...] = (5, 15, 30)
WORKER_FUNCTION = "matbodh_dashboard.runner.worker.execute"
JOB_TIMEOUT_SECONDS = 300  # engine queries stop at 120 s; an RQ timeout is too_heavy


class Runner(Protocol):
    def run(self, config: dict) -> dict: ...


class JobQueue(Protocol):
    def submit(self, fp: str, config: dict) -> None: ...

    def state(self, fp: str) -> JobState: ...


def attempt(runner: Runner, cache: ResultCache, fp: str, config: dict) -> EngineError | None:
    """Run once; store a success and return None, or return the classified error.

    The caller decides whether to retry or to store the error.
    """
    cache.put_timing(fp, started_at=time.time())
    try:
        result = runner.run(config)
        cache.put(fp, result)
        return None
    except EngineError as err:
        return err
    except Exception as exc:  # includes an unserialisable result (TypeError)
        return classify(exc)
    finally:
        cache.put_timing(fp, finished_at=time.time())


def _cached_state(cache: ResultCache, fp: str) -> JobState | None:
    if cache.get(fp) is not None:
        return "done"
    if cache.error(fp) is not None:
        return "failed"
    return None


class InlineQueue:
    """Executes synchronously in the caller (tests and the smoke script)."""

    def __init__(
        self,
        runner: Runner,
        cache: ResultCache,
        *,
        backoff: Sequence[float] = RETRY_INTERVALS,
        sleep: Callable[[float], Any] = time.sleep,
    ) -> None:
        self._runner = runner
        self._cache = cache
        self._backoff = tuple(backoff)
        self._sleep = sleep

    def submit(self, fp: str, config: dict) -> None:
        if self._cache.get(fp) is not None:
            return
        self._cache.clear_error(fp)
        self._cache.put_timing(fp, submitted_at=time.time())
        retries = iter(self._backoff)
        while True:
            error = attempt(self._runner, self._cache, fp, config)
            if error is None:
                return
            delay = next(retries, None) if error.kind == "infrastructure" else None
            if delay is None:
                self._cache.put_error(fp, error)
                return
            self._sleep(delay)

    def state(self, fp: str) -> JobState:
        return _cached_state(self._cache, fp) or "queued"


class RQQueue:
    """Enqueues ``worker.execute(fp, config)`` with job id = fingerprint."""

    def __init__(self, redis: Any, cache: ResultCache, queue_name: str = "engine") -> None:
        from rq import Queue

        self._redis = redis
        self._cache = cache
        self._queue = Queue(queue_name, connection=redis)

    def _job(self, fp: str) -> Any:
        from rq.exceptions import NoSuchJobError
        from rq.job import Job

        try:
            return Job.fetch(fp, connection=self._redis)
        except NoSuchJobError:
            return None

    @staticmethod
    def _in_flight(status: Any) -> JobState | None:
        from rq.job import JobStatus

        if status == JobStatus.STARTED:
            return "running"
        if status in (JobStatus.QUEUED, JobStatus.DEFERRED, JobStatus.SCHEDULED):
            return "queued"
        return None

    def submit(self, fp: str, config: dict) -> None:
        from rq import Retry

        if self._cache.get(fp) is not None:
            return
        job = self._job(fp)
        if job is not None:
            if self._in_flight(job.get_status()) is not None:
                return  # one job per fingerprint across cards and users
            job.delete()
        self._cache.clear_error(fp)
        self._cache.put_timing(fp, submitted_at=time.time())
        self._queue.enqueue(
            WORKER_FUNCTION,
            fp,
            config,
            job_id=fp,
            retry=Retry(max=len(RETRY_INTERVALS), interval=list(RETRY_INTERVALS)),
            job_timeout=JOB_TIMEOUT_SECONDS,
        )

    def state(self, fp: str) -> JobState:
        if self._cache.get(fp) is not None:
            return "done"
        job = self._job(fp)
        if job is not None:
            in_flight = self._in_flight(job.get_status())
            if in_flight is not None:
                return in_flight
        # Finished without a stored result, failed, stopped or vanished.
        return "failed"
