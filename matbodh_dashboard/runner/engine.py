"""Run one engine view config through the MatBodh runtime and classify failures."""

from __future__ import annotations

import dataclasses
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Literal

ErrorKind = Literal["config", "too_heavy", "infrastructure"]

_TOO_HEAVY_MARKERS = ("TOO_BIG_AST", "TIMEOUT_EXCEEDED", "TOO_MANY_ROWS")
_INFRASTRUCTURE_TYPES = (ConnectionError, TimeoutError, OSError)

MAX_EXECUTION_TIME = 120
MAX_RESULT_ROWS = 100000


class EngineError(Exception):
    def __init__(self, kind: ErrorKind, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message


def classify(exc: BaseException) -> EngineError:
    message = str(exc) or type(exc).__name__
    if any(marker in message for marker in _TOO_HEAVY_MARKERS):
        return EngineError("too_heavy", message)
    if isinstance(exc, _INFRASTRUCTURE_TYPES):
        return EngineError("infrastructure", message)
    return EngineError("config", message)


class EngineRunner:
    def __init__(self, runtime: Any) -> None:
        self._runtime = runtime

    def run(self, config: dict) -> dict:
        fd, name = tempfile.mkstemp(suffix=".json")
        path = Path(name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(config, handle)
            result = self._runtime.run(path)
            return dataclasses.asdict(result)
        except EngineError:
            raise
        except Exception as exc:
            raise classify(exc) from exc
        finally:
            path.unlink(missing_ok=True)


def build_runtime(env_file: Path) -> Any:
    """Open read-only connections from the engine .env and build the runtime.

    The caller owns the connections' lifetime (they are not closed here).
    """
    from matbodh_dash import (
        ClickHouseConnectAdapter,
        MySQLAccess,
        MySQLReadAdapter,
    )
    from matbodh_dash.metadata_runtime import MetadataSession
    from matbodh_views.connections import (
        create_clickhouse_client,
        create_mysql_connection,
    )
    from matbodh_views.named_runtime import NamedSurveyRuntime

    mysql = create_mysql_connection(env_file)
    client = create_clickhouse_client(env_file)
    query = ClickHouseConnectAdapter(
        client,
        max_execution_time=MAX_EXECUTION_TIME,
        max_result_rows=MAX_RESULT_ROWS,
    )
    return NamedSurveyRuntime(MySQLAccess(MySQLReadAdapter(mysql)), MetadataSession(query))
