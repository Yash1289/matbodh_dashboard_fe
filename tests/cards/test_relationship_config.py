import pytest

from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.families import family_meta, get_family


def _card(**over) -> CardConfig:
    data = {"id": "relationship.t", "family": "relationship", "section": "relationships", "title": "T",
            "cuts": [[], ["gender"]],
            "relationship": {"origin": "vs_past", "destination": "vs_voting_intention", "focal_party": "NDA"}}
    data.update(over)
    return CardConfig.model_validate(data)


def _rel(**over) -> dict:
    return {"origin": "vs_past", "destination": "vs_voting_intention", "focal_party": "NDA", **over}


def test_valid_card_loads():
    card = _card()
    assert card.relationship.origin == "vs_past" and card.relationship.focal_party == "NDA"
    assert card.view is None
    assert family_meta(get_family("relationship")).capabilities.modes == ["standalone", "trend"]


def test_view_table_is_checked_per_family():
    assert _card(view={"table": "matrix"}).view.table == "matrix"
    with pytest.raises(ValueError):
        _card(view={"table": "flips"})
    with pytest.raises(ValueError):
        CardConfig.model_validate({
            "id": "b", "family": "seat_benchmark", "section": "b", "title": "T",
            "scenarios": ["vs_voting_intention"], "benchmark": {"focal_party": "NDA"},
            "view": {"table": "matrix"}})


def test_requires_relationship_block_and_only_there():
    with pytest.raises(ValueError, match="relationship block"):
        _card(relationship=None)
    with pytest.raises(ValueError, match="relationship"):
        CardConfig.model_validate({
            "id": "d", "family": "distribution", "section": "s", "title": "T",
            "scenarios": ["vs_voting_intention"], "relationship": _rel()})


@pytest.mark.parametrize("rel", [
    _rel(destination="vs_past"),                       # same endpoint twice
    _rel(destination="pm_satisfaction"),               # opinion scenario
    _rel(origin="no_such_scenario"),                   # unknown scenario
])
def test_origin_and_destination_rules(rel):
    with pytest.raises(ValueError):
        _card(relationship=rel)


def test_include_recalled_only_on_a_recalled_endpoint():
    ok = _card(relationship=_rel(include_recalled={"origin": ["Did Not Vote"]}))
    assert ok.relationship.include_recalled == {"origin": ["Did Not Vote"]}
    for bad in ({"origin": ["Did Not Vote"]}, {"destination": ["Do Not Remember"]}, {"origin": ["Maybe"]}):
        rel = _rel(include_recalled=bad)
        if "Did Not Vote" in str(bad) and "origin" in bad:
            rel["origin"] = "mla_choice_party"        # current-survey origin: not recalled
        with pytest.raises(ValueError):
            _card(relationship=rel)


@pytest.mark.parametrize("extra", [
    {"scenarios": ["vs_voting_intention"]},
    {"comparison": {"mode": "trend"}},
    {"caste_clubbing": True},
    {"filters": [{"field": "gender", "values": ["Male"]}]},
    {"rank": {"metric": "support_share", "party_id": "NDA", "level": "ac"}},
    {"benchmark": {"focal_party": "NDA"}},
])
def test_forbidden_blocks(extra):
    with pytest.raises(ValueError):
        _card(**extra)


def test_cuts_follow_grid_rules():
    with pytest.raises(ValueError, match="duplicate cut"):
        _card(cuts=[["gender"], ["gender"]])
    with pytest.raises(ValueError, match="at least one cut"):
        _card(cuts=[])
