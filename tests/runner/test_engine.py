import dataclasses
import json
from pathlib import Path

import pytest

from matbodh_dashboard.runner.engine import EngineError, EngineRunner, classify


@dataclasses.dataclass
class FakeResult:
    rows: list
    total: int


class RecordingRuntime:
    def __init__(self, result=None, exc=None):
        self.result, self.exc = result, exc
        self.path = None
        self.seen = None

    def run(self, path):
        self.path = Path(path)
        self.seen = json.loads(self.path.read_text(encoding="utf-8"))
        if self.exc:
            raise self.exc
        return self.result


def test_run_returns_asdict():
    rt = RecordingRuntime(result=FakeResult(rows=[1, 2], total=2))
    out = EngineRunner(rt).run({"a": 1})
    assert out == {"rows": [1, 2], "total": 2}
    assert rt.seen == {"a": 1}
    assert rt.path.suffix == ".json"
    assert not rt.path.exists()


def test_temp_file_removed_on_error():
    rt = RecordingRuntime(exc=ValueError("Missing factor"))
    with pytest.raises(EngineError) as ei:
        EngineRunner(rt).run({"a": 1})
    assert ei.value.kind == "config"
    assert not rt.path.exists()


@pytest.mark.parametrize(
    "exc,kind",
    [
        (ValueError("Missing factor"), "config"),
        (RuntimeError("Code: 168. TOO_BIG_AST"), "too_heavy"),
        (ConnectionError(), "infrastructure"),
        (ValueError("TIMEOUT_EXCEEDED"), "too_heavy"),
        (RuntimeError("TOO_MANY_ROWS"), "too_heavy"),
        (TimeoutError("slow"), "infrastructure"),
        (OSError("disk"), "infrastructure"),
    ],
)
def test_classify(exc, kind):
    err = classify(exc)
    assert err.kind == kind
    assert isinstance(err.message, str)


def test_too_heavy_wins_over_infrastructure():
    assert classify(ConnectionError("TIMEOUT_EXCEEDED")).kind == "too_heavy"


def test_classify_real_driver_network_errors():
    from clickhouse_connect.driver.exceptions import DatabaseError as ChDatabaseError
    from clickhouse_connect.driver.exceptions import OperationalError as ChOperational
    from mysql.connector.errors import InterfaceError, OperationalError

    for exc in (ChOperational("down"), InterfaceError("lost"), OperationalError("gone")):
        assert classify(exc).kind == "infrastructure"
    assert classify(ChDatabaseError("Code: 168. TOO_BIG_AST")).kind == "too_heavy"
    assert classify(ChOperational("TIMEOUT_EXCEEDED")).kind == "too_heavy"


def test_mkstemp_failure_is_classified(monkeypatch):
    def boom(**kw):
        raise OSError("no temp")

    monkeypatch.setattr("tempfile.mkstemp", boom)
    with pytest.raises(EngineError) as ei:
        EngineRunner(RecordingRuntime()).run({})
    assert ei.value.kind == "infrastructure"


def test_build_runtime_closes_mysql_if_clickhouse_fails(monkeypatch):
    import matbodh_views.connections as conns

    closed = []

    class Conn:
        def close(self):
            closed.append(True)

    monkeypatch.setattr(conns, "create_mysql_connection", lambda f: Conn())

    def fail(f):
        raise ConnectionError("ch down")

    monkeypatch.setattr(conns, "create_clickhouse_client", fail)
    from matbodh_dashboard.runner.engine import build_runtime

    with pytest.raises(ConnectionError):
        build_runtime(Path("x.env"))
    assert closed == [True]
