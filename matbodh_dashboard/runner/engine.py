"""Run one engine view config through the MatBodh runtime and classify failures."""

from __future__ import annotations

import dataclasses
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Literal

ErrorKind = Literal["config", "too_heavy", "infrastructure"]

_TOO_HEAVY_MARKERS = ("TOO_BIG_AST", "TIMEOUT_EXCEEDED", "TOO_MANY_ROWS",
                      "MEMORY_LIMIT_EXCEEDED")
# Only an engine ValueError (a configuration verdict) keeps its text. Other
# exception text can carry hosts, users or SQL, so it never leaves the worker.
GENERIC_MESSAGES = {
    "infrastructure": "engine infrastructure error; the job can be retried later",
    "too_heavy": "the cut is too heavy for the engine; narrow the selection",
}


def _infrastructure_types() -> tuple[type[BaseException], ...]:
    """Builtin network errors plus driver errors that are not OSError subclasses."""
    types: list[type[BaseException]] = [ConnectionError, TimeoutError, OSError]
    try:
        from clickhouse_connect.driver.exceptions import OperationalError as ChOperational

        types.append(ChOperational)
    except ImportError:
        pass
    try:
        from mysql.connector.errors import InterfaceError, OperationalError

        types.extend([InterfaceError, OperationalError])
    except ImportError:
        pass
    return tuple(types)


MAX_EXECUTION_TIME = 120
MAX_RESULT_ROWS = 100000


class EngineError(Exception):
    """A classified job failure; ``message`` is safe to show to API clients."""

    def __init__(self, kind: ErrorKind, message: str, error_type: str | None = None) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.error_type = error_type  # the original exception's type name, for logs


def classify(exc: BaseException) -> EngineError:
    raw = str(exc) or type(exc).__name__
    error_type = type(exc).__name__
    if any(marker in raw for marker in _TOO_HEAVY_MARKERS):
        return EngineError("too_heavy", GENERIC_MESSAGES["too_heavy"], error_type)
    if isinstance(exc, _infrastructure_types()):
        return EngineError("infrastructure", GENERIC_MESSAGES["infrastructure"], error_type)
    if isinstance(exc, ValueError):  # the engine's validation verdicts
        return EngineError("config", raw, error_type)
    return EngineError("config", f"the engine rejected the configuration ({error_type})",
                       error_type)


def client_message(kind: str, message: str) -> str:
    """The message an API client may see for a classified error."""
    return message if kind == "config" else GENERIC_MESSAGES.get(kind, "engine job failed")


# The key the engine scans for: any snapshot keyed by ac_num whose rows carry pc_num.
MEMBERSHIP_KEY = "ac_pc_membership"


class EngineRunner:
    def __init__(self, runtime: Any) -> None:
        self._runtime = runtime
        # The AC-to-PC membership of a state never changes, so it is read once per state and kept.
        self._membership: dict[str, Any] = {}

    def _snapshots(self, config: dict) -> dict[str, Any] | None:
        """Aligned PC coverage over AC-designed rounds needs the complete AC-keyed membership in the
        engine snapshots. The plain and relationship views take it from the host; ranking, benchmark
        and selection bring their own."""
        if any(key in config for key in ("ranking", "benchmark", "selection")):
            return None
        request = config.get("request") or {}
        if request.get("coverage_mode", "independent") == "independent":
            return None
        if not any(f.get("field") == "pc_num" for f in request.get("filters", [])):
            return None
        state = request["state"]
        if state not in self._membership:
            self._membership[state] = self._runtime.access.seat_snapshot(state, "ac")
        return {MEMBERSHIP_KEY: self._membership[state]}

    def run(self, config: dict) -> dict:
        path: Path | None = None
        try:
            fd, name = tempfile.mkstemp(suffix=".json")
            path = Path(name)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(config, handle)
            snapshots = self._snapshots(config)
            result = self._runtime.run(path, **({"snapshots": snapshots} if snapshots else {}))
            return dataclasses.asdict(result)
        except EngineError:
            raise
        except Exception as exc:
            raise classify(exc) from exc
        finally:
            if path is not None:
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
    try:
        client = create_clickhouse_client(env_file)
    except BaseException:
        mysql.close()
        raise
    query = ClickHouseConnectAdapter(
        client,
        max_execution_time=MAX_EXECUTION_TIME,
        max_result_rows=MAX_RESULT_ROWS,
    )
    return NamedSurveyRuntime(MySQLAccess(MySQLReadAdapter(mysql)), MetadataSession(query))
