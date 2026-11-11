"""The compiled job config must pass the engine's own strict loader and validation, offline."""
from __future__ import annotations

import copy

import pytest

from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
from matbodh_dashboard.compiler.rounds import resolve_rounds
from tests.cards.test_benchmark_compile import _catalogue, _compile, _ctx
from tests.compiler.engine_stub import validate_benchmark_with_engine

pytest.importorskip("matbodh_views.benchmark", reason="engine package not importable")


def _engine_ready(config: dict) -> dict:
    """What the alliance runtime adds before validation (namespace, version, mapping)."""
    config = copy.deepcopy(config)
    endpoint = config["benchmark"].get("reference")
    if endpoint and endpoint["source"] == "election":
        endpoint["parties"].update(namespace="MatBodh", version="test", mapping={})
    return config


@pytest.mark.parametrize("reference", [
    BenchmarkReference(kind="none"),
    BenchmarkReference(kind="compare"),
    BenchmarkReference(kind="election", year=2022, election_type="VS"),
])
def test_compiled_config_loads_and_validates_in_the_engine(reference):
    plan = _compile(reference=reference)
    assert plan.unavailable == ()
    rounds = resolve_rounds(_ctx(), _catalogue())
    validate_benchmark_with_engine(_engine_ready(plan.jobs[0].config), rounds)
