"""The compiled job config must pass the engine's own strict loader and validation, offline."""
from __future__ import annotations

import pytest

from matbodh_dashboard.compiler.rounds import resolve_rounds
from tests.cards.test_relationship_compile import _card, _catalogue, _compile, _ctx
from tests.compiler.engine_stub import validate_relationship_with_engine

pytest.importorskip("matbodh_dash.joint_relationships", reason="engine package not importable")

PLAIN = {"origin": "vs_past", "destination": "vs_voting_intention", "focal_party": "NDA"}


@pytest.mark.parametrize("relationship", [
    PLAIN,
    {**PLAIN, "include_recalled": {"origin": ["Did Not Vote", "Do Not Remember"]}},
    {"origin": "mla_choice_party", "destination": "vs_voting_intention", "focal_party": "NDA"},
    {"origin": "vs_past", "destination": "vs_voting_intention"},
])
def test_compiled_config_loads_and_validates_in_the_engine(relationship):
    plan = _compile(_card(relationship=relationship))
    assert plan.unavailable == ()
    rounds = resolve_rounds(_ctx(), _catalogue())
    validate_relationship_with_engine(plan.jobs[0].config, rounds)
