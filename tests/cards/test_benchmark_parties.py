from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace

import pytest
import yaml

from matbodh_dashboard.cards.benchmark.parties import (
    AllianceMajorParties, AllianceUnavailable, ElectionOption, load_elections,
)


class FakeSession:
    """Stands in for AllianceSession: records calls, returns a mapping-shaped identity."""

    def __init__(self, calls, fail=False):
        self.calls, self.fail = calls, fail

    def identity(self, state, *, reporting_type, year=None, election_type=None):
        self.calls.append((state, reporting_type, year, election_type))
        if self.fail:
            raise ValueError(f"Expected one state-level alliance context for {state}, found 0")
        return SimpleNamespace(mapping={"a": "NDA", "b": "NDA", "c": "SP+"})


def provider(calls, epoch, fail=False):
    @contextmanager
    def factory():
        yield FakeSession(calls, fail)

    return AllianceMajorParties(factory, lambda: epoch[0])


def test_identities_are_the_distinct_mapped_labels():
    calls: list = []
    got = provider(calls, [1]).identities("UP", "MatBodh", year=2022, election_type="VS")
    assert got == frozenset({"NDA", "SP+"})
    assert calls == [("UP", "MatBodh", 2022, "VS")]


def test_result_is_cached_per_epoch_and_refetched_after_epoch_bump():
    calls: list = []
    epoch = [1]
    p = provider(calls, epoch)
    p.identities("UP", "MatBodh")
    p.identities("UP", "MatBodh")
    assert len(calls) == 1
    epoch[0] = 2
    p.identities("UP", "MatBodh")
    assert len(calls) == 2


def test_no_alliance_context_raises_the_engines_message():
    with pytest.raises(ValueError, match="Expected one state-level alliance context"):
        provider([], [1], fail=True).identities("UP", "MatBodh", year=1999, election_type="LS")


def test_connection_failure_is_unavailable_not_cached_and_refetched():
    calls: list = []
    state = {"down": True}

    @contextmanager
    def factory():
        if state["down"]:
            raise ConnectionError("mysql unreachable")
        yield FakeSession(calls)

    p = AllianceMajorParties(factory, lambda: 1)
    with pytest.raises(AllianceUnavailable):
        p.identities("UP", "MatBodh")
    state["down"] = False
    assert p.identities("UP", "MatBodh") == frozenset({"NDA", "SP+"})


def test_missing_setting_while_connecting_is_unavailable_not_the_engines_verdict():
    @contextmanager
    def factory():
        raise ValueError("MYSQL_HOST is not set")
        yield

    with pytest.raises(AllianceUnavailable):
        AllianceMajorParties(factory, lambda: 1).identities("UP", "MatBodh")


def test_load_elections_reads_options_with_labels(tmp_path):
    path = tmp_path / "elections.yaml"
    path.write_text(yaml.safe_dump({"Uttar Pradesh": [{"year": 2022, "election_type": "VS"}]}))
    assert load_elections(path) == {"Uttar Pradesh": [ElectionOption(year=2022, election_type="VS", label="2022 VS")]}


def test_repo_elections_file_lists_the_seven_up_elections():
    from pathlib import Path

    got = load_elections(Path(__file__).resolve().parents[2] / "config" / "elections.yaml")
    assert [o.label for o in got["Uttar Pradesh"]] == [
        "2009 LS", "2012 VS", "2014 LS", "2017 VS", "2019 LS", "2022 VS", "2024 LS"]


def test_load_elections_rejects_duplicates(tmp_path):
    path = tmp_path / "elections.yaml"
    path.write_text(yaml.safe_dump({"UP": [{"year": 2022, "election_type": "VS"}, {"year": 2022, "election_type": "VS"}]}))
    with pytest.raises(ValueError, match="duplicate"):
        load_elections(path)
