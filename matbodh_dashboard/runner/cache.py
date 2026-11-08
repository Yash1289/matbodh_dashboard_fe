"""Redis result cache keyed by engine-config fingerprints.

Stores whole engine results (aggregates only, never respondent rows), the
classified error of a failed job, per-job timings and the alliance epoch that
is folded into every fingerprint.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any

from matbodh_dashboard.runner.engine import EngineError

EPOCH_KEY = "dash:alliance_epoch"
_RESULT = "dash:result:"
_ERROR = "dash:error:"
_TIMING = "dash:timing:"


class ResultCache:
    def __init__(self, redis: Any, ttl_seconds: int) -> None:
        if not isinstance(ttl_seconds, int) or ttl_seconds <= 0:
            raise ValueError(f"ttl_seconds must be a positive integer, got {ttl_seconds!r}")
        self._redis = redis
        self._ttl = ttl_seconds

    def get(self, fp: str) -> dict | None:
        raw = self._redis.get(_RESULT + fp)
        return None if raw is None else json.loads(raw)

    def put(self, fp: str, result: dict) -> None:
        """Store a result; it supersedes any error stored for the same fingerprint."""
        pipe = self._redis.pipeline()
        pipe.set(_RESULT + fp, json.dumps(result, default=_encode), ex=self._ttl)
        pipe.delete(_ERROR + fp)
        pipe.execute()

    def put_error(self, fp: str, error: EngineError) -> None:
        payload = {"kind": error.kind, "message": error.message}
        self._redis.set(_ERROR + fp, json.dumps(payload), ex=self._ttl)

    def error(self, fp: str) -> dict | None:
        raw = self._redis.get(_ERROR + fp)
        return None if raw is None else json.loads(raw)

    def clear_error(self, fp: str) -> None:
        self._redis.delete(_ERROR + fp)

    def put_timing(self, fp: str, **times: float) -> None:
        """Record job timestamps (submitted_at, started_at, finished_at)."""
        key = _TIMING + fp
        pipe = self._redis.pipeline()
        pipe.hset(key, mapping={k: repr(float(v)) for k, v in times.items()})
        pipe.expire(key, self._ttl)
        pipe.execute()

    def timing(self, fp: str) -> dict[str, float]:
        raw = self._redis.hgetall(_TIMING + fp)
        return {_text(k): float(_text(v)) for k, v in raw.items()}

    def alliance_epoch(self) -> int:
        raw = self._redis.get(EPOCH_KEY)
        return 0 if raw is None else int(raw)

    def bump_epoch(self) -> int:
        return int(self._redis.incr(EPOCH_KEY))


def _encode(value: object) -> object:
    """JSON for the non-JSON types engine contracts carry; anything else raises."""
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (set, frozenset)):
        return sorted(value, key=str)
    raise TypeError(f"engine result value of type {type(value).__name__} is not JSON")


def _text(value: bytes | str) -> str:
    return value.decode("utf-8") if isinstance(value, bytes) else value
