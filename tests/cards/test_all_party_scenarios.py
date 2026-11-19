import pytest
from pydantic import ValidationError

from matbodh_dashboard.cards.compile import compile_card
from matbodh_dashboard.cards.config import CardConfig, load_cards
from matbodh_dashboard.catalogue.store import load_catalogue
from tests.cards import test_compile as grid
from tests.fixtures.catalogue_rows import SCENARIOS, dataset_row, level_row, make_query
from tests.runner.test_service import FakeRunner, cache, ctx, make_service, rules  # noqa: F401


def overall(**over) -> CardConfig:
    data = {"id": "distribution.overall", "family": "distribution", "section": "coalitions", "title": "T",
            "all_party_scenarios": True, "cuts": [[]]}
    data.update(over)
    return CardConfig.model_validate(data)


@pytest.mark.parametrize("over", [
    {"scenarios": ["vs_voting_intention"]},
    {"family": "opinion"},
    {"cuts": [[], ["gender"]]},
    {"comparison": {"mode": "trend"}},
    {"filters": [{"field": "gender", "values": ["Female"]}]},
    {"caste_clubbing": True},
])
def test_all_party_scenarios_is_standalone_distribution_overall_with_no_scenarios_listed(over):
    with pytest.raises(ValidationError):
        overall(**over)


def test_other_families_cannot_set_it():
    with pytest.raises(ValidationError):
        CardConfig.model_validate({"id": "r", "family": "seat_ranking", "section": "s", "title": "T",
                                   "all_party_scenarios": True, "scenarios": ["pm_satisfaction"],
                                   "rank": {"metric": "net_score", "level": "ac"}})


def test_all_party_scenarios_expands_to_the_anchor_party_scenarios_only():
    rows = [dataset_row(f"2027 VS CAPI R{i}", round_number=i, available_fields=grid.FIELDS,
                        available_scenarios=([grid.VS, grid.PM, "made_up_scenario"] if i == 3 else list(SCENARIOS)))
            for i in (1, 2, 3)]
    levels = [level_row(f"2027 VS CAPI R{i}", range(1, 404)) for i in (1, 2, 3)]
    plan = compile_card(overall(), grid._ctx(), load_catalogue(make_query(rows, levels)), grid.PRESET)
    (job,) = plan.jobs
    assert job.config["request"]["scenarios"] == [grid.VS]  # opinion and unknown scenarios never added
    assert job.config["request"]["grouping_sets"] == [[]]


def test_no_party_scenario_in_the_anchor_round_is_unavailable_with_a_reason():
    rows = [dataset_row(f"2027 VS CAPI R{i}", round_number=i, available_fields=grid.FIELDS,
                        available_scenarios=[grid.PM]) for i in (1, 2, 3)]
    levels = [level_row(f"2027 VS CAPI R{i}", range(1, 404)) for i in (1, 2, 3)]
    plan = compile_card(overall(), grid._ctx(), load_catalogue(make_query(rows, levels)), grid.PRESET)
    assert plan.jobs == () and any("party scenario" in r for _, r in plan.unavailable)


def test_the_seeded_overall_vote_share_card_loads_from_yaml():
    cards = load_cards(grid.ROOT / "tests/fixtures/cards.yaml")
    card = cards["distribution.overall_vote_share"]
    assert card.all_party_scenarios and card.cuts == [[]] and card.scenarios == []


def test_the_payload_columns_follow_the_expanded_scenarios_not_the_empty_config(rules, cache):  # noqa: F811
    card = overall(id="t.overall")
    service, _ = make_service(rules, cache, cards={card.id: card})
    status = service.status(service.start(card.id, ctx()))
    assert status.state == "done"
    result = status.result
    assert {c["key"] for c in result["columns"]} >= {"vs_voting_intention:NDA", "vs_voting_intention:SP+"}
    assert any(c["value"] is not None for c in result["cuts"][0]["cells"])


def _anchor_with(scenarios):
    rows = [dataset_row(f"2027 VS CAPI R{i}", round_number=i, available_fields=grid.FIELDS,
                        available_scenarios=list(scenarios)) for i in (1, 2, 3)]
    levels = [level_row(f"2027 VS CAPI R{i}", range(1, 404)) for i in (1, 2, 3)]
    return load_catalogue(make_query(rows, levels))


def test_party_scenarios_needing_an_external_weight_binding_are_left_out():
    # cm_choice_party has no embedded weights: the engine refuses it without an owner-approved
    # external binding ("Explicit external weight binding required"), so it is never added here.
    plan = compile_card(overall(), grid._ctx(),
                        _anchor_with([grid.VS, "vs_past", "cm_choice_party", "state_govt_change_party", grid.PM]),
                        grid.PRESET)
    (job,) = plan.jobs
    assert job.config["request"]["scenarios"] == ["vs_past", grid.VS]
