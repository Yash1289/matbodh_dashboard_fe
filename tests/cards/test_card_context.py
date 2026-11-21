import pytest

from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.context import card_context
from tests.cards.test_compile import R1, R2, R3, VS, _compile, _config, _ctx, _request


def test_without_overrides_the_context_is_the_same_object():
    ctx = _ctx()
    assert card_context(_config(), ctx) is ctx


def test_overrides_replace_anchor_and_compare():
    ctx = card_context(_config(anchor_round=R2, compare_round=R1, comparison={
        "mode": "compare", "target": {"round": "anchor", "scenario": VS},
        "reference": {"round": "compare", "scenario": VS}}), _ctx())
    assert (ctx.anchor_round, ctx.compare_round) == (R2, R1)


def test_unknown_round_is_named():
    with pytest.raises(ValueError, match="Round 'Nope' is not among the selected rounds"):
        card_context(_config(anchor_round="Nope"), _ctx())


def test_compare_round_is_rejected_outside_compare_mode():
    with pytest.raises(ValueError, match="compare_round"):
        _config(compare_round=R1)


def test_distribution_reads_the_card_round():
    plan = _compile(_config(anchor_round=R2))
    assert _request(plan)["observations"] == [{"id": "o2", "survey_name": R2}]


def test_card_compare_round_replaces_the_context_one():
    config = _config(anchor_round=R3, compare_round=R2,
                     comparison={"mode": "compare", "target": {"round": "anchor", "scenario": VS},
                                 "reference": {"round": "compare", "scenario": VS}})
    request = _request(_compile(config))
    assert {o["survey_name"] for o in request["observations"]} == {R3, R2}


def test_unknown_card_round_makes_the_card_unavailable_not_an_error():
    plan = _compile(_config(anchor_round="Nope"))
    assert plan.unavailable and "Nope" in plan.unavailable[0][1]


def test_seat_ranking_reads_the_card_round():
    config = CardConfig.model_validate({
        "id": "r1", "family": "seat_ranking", "title": "T", "scenarios": [VS], "anchor_round": R2,
        "rank": {"level": "ac", "metric": "support_share", "party_id": "BJP"}})
    plan = _compile(config)
    assert plan.anchor == R2


def test_seat_ranking_on_a_state_round_is_refused():
    config = CardConfig.model_validate({
        "id": "r1", "family": "seat_ranking", "title": "T", "scenarios": [VS], "anchor_round": R2,
        "rank": {"level": "ac", "metric": "support_share", "party_id": "BJP"}})
    plan = _compile(config, level="state")
    assert plan.unavailable
