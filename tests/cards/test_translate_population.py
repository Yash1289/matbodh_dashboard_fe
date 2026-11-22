"""Pop % is the anchor round's population share, copied from the engine's `populations`."""
from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.families import FAMILIES
from matbodh_dashboard.cards.field_map import load_field_map
from matbodh_dashboard.cards.translate import translate_grid
from tests.cards.translate_helpers import VS, context_for, dim, mini_result, mini_row


def _population(obs, gs, dims, share):
    return {"observation_id": obs, "grouping_set_id": gs, "dimensions": dims, "composition_share": share}


def _translate(rows, populations, cuts, anchor="o2"):
    config = CardConfig.model_validate({"id": "c1", "family": "distribution", "section": "cards", "title": "T",
                                        "scenarios": [VS], "cuts": cuts, "surveys": ["o1", "o2"]})
    result = mini_result(rows=rows, populations=populations)
    return translate_grid(config, FAMILIES["distribution"], result,
                          context_for(result, anchor=anchor, obs=["o1", "o2"]))


def _shares(payload, cut_id="g0"):
    return {p.row: p.value for p in next(c for c in payload.cuts if c.id == cut_id).population}


AGE = {"age_group": dim("18-25")}


def test_population_comes_from_anchor_round_only():
    rows = [mini_row(obs=o, dims=AGE) for o in ("o1", "o2")]
    pops = [_population("o1", "g0", AGE, 10.0), _population("o2", "g0", AGE, 30.0)]
    assert _shares(_translate(rows, pops, [["age_group"]])) == {"age_group=18-25": 30.0}


def test_population_value_is_engine_value_unchanged_for_parent_and_child():
    child = {"age_group": dim("18-25"), "gender": dim("Male")}
    rows = [mini_row(obs="o2", dims=AGE), mini_row(obs="o2", gs="g1", dims=child)]
    pops = [_population("o2", "g0", AGE, 14.2), _population("o2", "g1", child, 7.4)]
    payload = _translate(rows, pops, [["age_group"], ["age_group", "gender"]])
    assert _shares(payload, "g0") == {"age_group=18-25": 14.2}
    assert _shares(payload, "g1") == {"age_group=18-25|gender=Male": 7.4}


def test_anchor_without_population_item_gives_no_entry():
    rows = [mini_row(obs="o2", dims=AGE)]
    payload = _translate(rows, [_population("o1", "g0", AGE, 10.0)], [["age_group"]])
    assert _shares(payload) == {}
    assert [r.key for r in payload.cuts[0].rows] == ["age_group=18-25"]


def test_population_capability_matches_field_map():
    for family, spec in FAMILIES.items():
        try:
            has = "populations" in load_field_map(family)
        except Exception:  # families whose payload is not a grid have no field map
            has = False
        assert spec.capabilities.population == has, family


def test_payload_names_the_seat_fields_its_tables_use():
    from tests.cards.translate_helpers import mini_row

    def seat_fields(cuts):
        config = CardConfig.model_validate({"id": "c1", "family": "distribution", "section": "cards", "title": "T",
                                            "scenarios": [VS], "cuts": cuts})
        result = mini_result(rows=[mini_row(obs="o2")])
        return translate_grid(config, FAMILIES["distribution"], result, context_for(result, anchor="o2", obs=["o2"])).seat_fields

    assert seat_fields([["ac_num"], ["ac_num", "gender"]]) == ["ac_num"]
    assert seat_fields([["party_zone", "age_group"], ["gender"]]) == ["party_zone"]
    assert seat_fields([["gender"], ["age_group", "gender"]]) == []
