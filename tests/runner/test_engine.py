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
