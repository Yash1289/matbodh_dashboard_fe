"""The runner supplies the AC-to-PC membership the engine needs to align PC coverage over AC rounds."""
import dataclasses
import json
from pathlib import Path

from matbodh_dashboard.runner.engine import EngineRunner

MEMBERSHIP = object()


@dataclasses.dataclass
class Result:
    rows: list


class FakeAccess:
    def __init__(self):
        self.loads = []

    def seat_snapshot(self, state, level, *args, **kwargs):
        self.loads.append((state, level))
        return MEMBERSHIP


class FakeRuntime:
    def __init__(self):
        self.access = FakeAccess()
        self.calls = []

    def run(self, path, **kwargs):
        self.calls.append((json.loads(Path(path).read_text(encoding="utf-8")), kwargs))
        return Result([])


def config(filters=(), coverage="common", state="Uttar Pradesh", **operation):
    return {"request": {"state": state, "filters": list(filters), "coverage_mode": coverage}, **operation}


PC_FILTER = {"field": "pc_num", "operator": "in", "values": ["3", "7"]}


def run(runner, cfg):
    runner.run(cfg)
    return runner._runtime.calls[-1][1]


def test_a_pc_filter_with_aligned_coverage_gets_the_membership_snapshot():
    runtime = FakeRuntime()
    kwargs = run(EngineRunner(runtime), config([PC_FILTER]))
    assert kwargs == {"snapshots": {"ac_pc_membership": MEMBERSHIP}}
    assert runtime.access.loads == [("Uttar Pradesh", "ac")]


def test_a_relationship_job_gets_it_too():
    runtime = FakeRuntime()
    kwargs = run(EngineRunner(runtime), config([PC_FILTER], relationship={"id": "relationship"}))
    assert "snapshots" in kwargs


def test_the_membership_is_loaded_once_per_state():
    runtime = FakeRuntime()
    runner = EngineRunner(runtime)
    run(runner, config([PC_FILTER]))
    run(runner, config([PC_FILTER]))
    run(runner, config([PC_FILTER], state="Bihar"))
    assert runtime.access.loads == [("Uttar Pradesh", "ac"), ("Bihar", "ac")]


def test_nothing_is_loaded_or_passed_when_it_is_not_needed():
    runtime = FakeRuntime()
    runner = EngineRunner(runtime)
    for cfg in (
        config([PC_FILTER], coverage="independent"),             # not aligned
        config([{"field": "ac_num", "operator": "in", "values": ["3"]}]),  # an AC filter
        config([]),                                              # no filter
        config([PC_FILTER], ranking={"id": "r"}),                # ranking brings its own
        config([PC_FILTER], benchmark={"id": "b"}),
        config([PC_FILTER], selection={"id": "s"}),
    ):
        assert run(runner, cfg) == {}
    assert runtime.access.loads == []
