"""Guards that State Pulse and its scoreboard pipeline stay removed (product decision)."""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("module", [
    "matbodh_dashboard.templates",
    "matbodh_dashboard.normalise.cells",
])
def test_retired_modules_are_gone(module):
    assert importlib.util.find_spec(module) is None


def test_pulse_templates_are_gone():
    assert not (ROOT / "config" / "templates").exists()


def test_planner_only_exposes_job_and_plan_types_and_helpers():
    from matbodh_dashboard.compiler import plan

    for name in ("plan_card", "bind_contenders", "EngineJob", "RunPlan", "rounds_block",
                 "field_available"):
        assert hasattr(plan, name) == (name not in ("plan_card", "bind_contenders"))
