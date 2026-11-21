import json

import pytest

from matbodh_dashboard.cards.config import CardConfig, scenario_kind
from matbodh_dashboard.cards.families import FAMILIES
from matbodh_dashboard.cards.translate import column_key, row_key, translate_grid
from tests.cards.samples import FAMILY_SAMPLES, load_sample
from tests.cards.translate_helpers import (
    VS,
    context_for,
    dim,
    mini_comparison,
    mini_result,
    mini_row,
)

PAIRS = [(family, name) for family, names in FAMILY_SAMPLES.items() for name in names]


def _config(family="distribution", scenarios=(VS,), **overrides) -> CardConfig:
    data = {"id": "c1", "family": family, "section": "cards", "title": "T",
            "scenarios": list(scenarios)}
    data.update(overrides)
    return CardConfig.model_validate(data)


def _translate(result, config=None, **context):
    config = config or _config()
    return translate_grid(config, FAMILIES[config.family], result, context_for(result, **context))


def _cells(payload):
    return {(cut.id, c.row, c.column, c.round, c.lens): c for cut in payload.cuts for c in cut.cells}


def _owned(item, source):
    return source.domain is None or item.get("outcome_domain") in source.domain


def _series(array, item):
    if array == "scores":
        return None
    return item.get("party_id") if item.get("outcome_domain", "party") == "party" or array != "rows" \
        else item.get("option_id")


def _item_dims(item):
    return [(n, d["value"], d["is_subtotal"]) for n, d in item["dimensions"].items()]


@pytest.mark.parametrize(("family", "name"), PAIRS)
def test_values_are_copied_verbatim(family, name):
    result = load_sample(name)
    spec = FAMILIES[family]
    checked = 0
    arrays = {s.array for s in spec.lens_sources.values()}
    combos = sorted({(i["observation_id"], i["scenario_id"])
                     for array in arrays for i in result.get(array) or ()})
    for obs, scenario in combos:
        if scenario_kind(scenario) != spec.scenario_kind:
            continue
        config = _config(family, (scenario,))
        payload = translate_grid(config, spec, result, context_for(result, anchor=obs))
        cells = _cells(payload)
        allowed = {}
        for lens_id, source in spec.lens_sources.items():
            array = source.array
            items = [i for i in result.get(array) or ()
                     if (i["observation_id"], i["scenario_id"]) == (obs, scenario)
                     and _owned(i, source)]
            allowed[lens_id] = {i.get(source.field) for i in items}
            for item in items:
                if source.field not in item:
                    continue
                non_subtotal = [d for d in _item_dims(item) if not d[2]]
                key = (item["grouping_set_id"], row_key(non_subtotal),
                       column_key(scenario, _series(array, item)), obs, lens_id)
                assert key in cells, key
                assert cells[key].value == item[source.field]
                checked += 1
        for cell in cells.values():
            assert cell.value is None or cell.value in allowed[cell.lens]
    assert checked > 0


def test_null_value_is_not_zero():
    payload = _translate(mini_result(rows=[mini_row(support_share=None, composition_share=20.0)]))
    cell = _cells(payload)[("g0", "overall", column_key(VS, "NDA"), "o1", "support_share")]
    assert cell.value is None and cell.status == "null_value"
    assert 0.0 not in [c.value for cut in payload.cuts for c in cut.cells if c.lens == "support_share"]


def test_row_key_separates_subtotal_from_genuine_null():
    assert row_key([("category", "GEN", False), ("caste", None, False)]) == "category=GEN|caste=~null"
    assert row_key([("category", "GEN", False), ("caste", None, True)]) == "category=GEN"
    assert row_key([]) == "overall"


def test_subtotal_and_genuine_null_dimension_are_distinct_rows():
    rows = [
        mini_row(gs="g1", dims={"category": dim("GEN"), "caste": dim(None)}),
        mini_row(gs="g2", dims={"category": dim("GEN"), "caste": dim(None, True)}),
    ]
    config = _config(cuts=[[], ["category", "caste"], ["category"]])
    payload = _translate(mini_result(rows=rows), config)
    by_id = {cut.id: cut for cut in payload.cuts}
    (null_row,) = by_id["g1"].rows
    (total_row,) = by_id["g2"].rows
    assert null_row.key == "category=GEN|caste=~null" and null_row.subtotal == []
    assert null_row.labels["caste"] is None
    assert total_row.key == "category=GEN" and total_row.subtotal == ["caste"]


def test_population_only_group_becomes_an_empty_row():
    populations = [{"observation_id": "o1", "grouping_set_id": "g1", "composition_share": 7.0,
                    "dimensions": {"category": dim("ST")}}]
    rows = [mini_row(gs="g1", dims={"category": dim("GEN")})]
    payload = _translate(mini_result(rows=rows, populations=populations),
                         _config(cuts=[[], ["category"]]))
    (cut,) = [c for c in payload.cuts if c.id == "g1"]
    assert {r.key for r in cut.rows} == {"category=GEN", "category=ST"}
    assert not [c for c in cut.cells if c.row == "category=ST"]


def test_lens_without_data_is_not_listed():
    payload = _translate(mini_result(rows=[mini_row(composition_share=None)]))
    listed = [lens.id for lens in payload.meta.lenses]
    assert "support_share" in listed
    assert "contribution_share" not in listed and "composition_share" not in listed
    assert payload.meta.default_lens == "support_share"


def test_compare_deltas_come_from_comparison_rows():
    o1, o2 = "o1", "o2"
    result = mini_result(
        rows=[mini_row(obs=o1, support_share=40.0), mini_row(obs=o2, support_share=43.5,
                                                              size_of_impact_pp=0.9)],
        comparisons=[mini_comparison(target=(o2, VS), reference=(o1, VS))])
    config = _config(scenarios=[], comparison={
        "mode": "compare", "target": {"scenario": VS},
        "reference": {"round": "compare", "scenario": VS}})
    payload = _translate(result, config, anchor=o2, compare=o1)
    assert payload.mode == "compare"
    (cut,) = payload.cuts
    assert {c.round for c in cut.cells} == {o2}
    deltas = {d.lens: d for d in cut.deltas}
    assert deltas["support_share"].value == 3.5 and deltas["support_share"].status == "available"
    assert deltas["support_share"].reference_value == 40.0
    assert deltas["support_share"].relative_change_pct == 8.75
    assert deltas["support_share"].target == f"o2:{VS}" and deltas["support_share"].reference == f"o1:{VS}"
    assert deltas["size_of_impact_pp"].value == 0.9


def test_missing_comparison_status_keeps_value_and_marks_delta():
    result = mini_result(
        rows=[mini_row(obs="o1"), mini_row(obs="o2", support_share=43.5)],
        comparisons=[mini_comparison(target=("o2", VS), reference=("o1", VS), pp=None, impact=None,
                                     status="missing_reference")])
    config = _config(scenarios=[], comparison={
        "mode": "compare", "target": {"scenario": VS},
        "reference": {"round": "compare", "scenario": VS}})
    payload = _translate(result, config, anchor="o2", compare="o1")
    (cut,) = payload.cuts
    delta = next(d for d in cut.deltas if d.lens == "support_share")
    assert delta.value is None and delta.status == "missing_reference"
    assert next(c for c in cut.cells if c.lens == "support_share").value == 43.5


@pytest.mark.parametrize("mode", ["standalone", "trend"])
def test_no_deltas_in_trend_or_standalone(mode):
    result = mini_result(
        rows=[mini_row(obs="o1"), mini_row(obs="o2", support_share=43.5)],
        comparisons=[mini_comparison(target=("o2", VS), reference=("o1", VS))])
    payload = _translate(result, _config(comparison={"mode": mode}), anchor="o2")
    assert all(cut.deltas == [] for cut in payload.cuts)


def test_trend_has_one_cell_per_round_and_not_asked_rounds_are_listed():
    result = mini_result(rows=[mini_row(obs=o, support_share=v)
                               for o, v in (("o2", 41.0), ("o3", 44.0))])
    not_asked = [{"part": "grid", "rounds": ["o1"]}]
    payload = _translate(result, _config(comparison={"mode": "trend"}), obs=["o1", "o2", "o3"],
                         not_asked=not_asked)
    support = [c for c in payload.cuts[0].cells if c.lens == "support_share"]
    assert [c.round for c in support] == ["o2", "o3"] and [c.value for c in support] == [41.0, 44.0]
    assert payload.not_asked == not_asked and payload.mode == "trend"


def test_standalone_keeps_only_the_anchor_round_and_configured_scenario():
    result = mini_result(rows=[mini_row(obs="o1"), mini_row(obs="o2", support_share=43.5),
                               mini_row(obs="o2", scenario="ls_past", support_share=9.0)])
    payload = _translate(result, anchor="o2")
    assert {(c.round, c.column) for c in payload.cuts[0].cells} == {("o2", column_key(VS, "NDA"))}


def test_cut_ids_and_dimensions_follow_config_cuts():
    rows = [mini_row(gs="g0"),
            mini_row(gs="g1", dims={"category": dim("GEN"), "caste": dim("Jat")})]
    config = _config(cuts=[[], ["caste", "category"]])
    payload = _translate(mini_result(rows=rows), config)
    assert [(c.id, c.dimensions) for c in payload.cuts] == [("g0", []), ("g1", ["caste", "category"])]


def test_payload_is_json_serialisable_and_labelled():
    payload = _translate(mini_result(rows=[mini_row()]))
    json.dumps(payload.model_dump())
    assert payload.family == "distribution" and payload.card_id == "c1"
    assert payload.columns[0].kind == "party" and payload.columns[0].scenario == VS


@pytest.mark.parametrize(("family", "name"), PAIRS)
def test_lens_units_match_engine_units(family, name):
    result = load_sample(name)
    spec = FAMILIES[family]
    units = {"percentage": "percentage", "percentage_points": "percentage_points"}
    for lens in spec.lenses:
        source = spec.lens_sources[lens.id]
        for item in (result.get(source.array) or ())[:50]:
            if not _owned(item, source):
                continue
            declared = None
            if source.array == "scores":
                declared = (item.get("measure_units") or {}).get(source.field)
            elif source.array == "rows" and source.field == "support_share":
                declared = item.get("unit")
            elif source.array == "rows" and source.field == "size_of_impact_pp":
                declared = item.get("impact_unit")
            if declared is not None:
                assert units[declared] == lens.unit, (lens.id, declared)


def test_gender_base_status_flags_only_the_lens_whose_own_value_is_missing():
    """Engine rows flagged missing_or_zero_gender_base still carry valid values for other lenses."""
    result = load_sample("result_gd.json")
    payload = _translate(result, _config("gender_differential"))
    cells = [c for cut in payload.cuts for c in cut.cells]
    assert all(c.status == "available" for c in cells if c.value is not None)
    assert {c.status for c in cells if c.value is None} <= {"null_value", "missing_or_zero_gender_base"}
    impact = [c for c in cells if c.lens == "size_of_impact_pp" and c.value is not None]
    assert impact and all(c.status == "available" for c in impact)


def test_a_hidden_value_hides_its_row_in_a_multi_dimension_cut(tmp_path):
    from matbodh_dashboard.registry import load_rules

    (tmp_path / "global.yaml").write_text("rules:\n  - field: gender\n    hidden: [Other]\n", encoding="utf-8")
    rows = [mini_row(gs="g1", dims={"caste": dim("Jat"), "gender": dim(g)}) for g in ("Female", "Male", "Other")]
    payload = _translate(mini_result(rows=rows), _config(cuts=[[], ["caste", "gender"]]), rules=load_rules(tmp_path))
    (cut,) = [c for c in payload.cuts if c.id == "g1"]
    assert {r.key for r in cut.rows} == {"caste=Jat|gender=Female", "caste=Jat|gender=Male"}
    assert not [c for c in cut.cells if c.row.endswith("gender=Other")]
    assert payload.hidden_count >= 1


def test_several_chosen_surveys_each_keep_their_own_round():
    result = mini_result(rows=[mini_row(obs="o1", support_share=40.0), mini_row(obs="o2", support_share=43.5),
                               mini_row(obs="o2", scenario="ls_past", support_share=9.0)])
    config = _config(surveys=["R1", "R2"])
    payload = _translate(result, config, anchor="o2", obs=["o1", "o2"])
    support = {(c.round, c.column): c.value for c in payload.cuts[0].cells if c.lens == "support_share"}
    assert support == {("o1", column_key(VS, "NDA")): 40.0, ("o2", column_key(VS, "NDA")): 43.5}


def test_merge_results_joins_rows_and_merges_per_survey_objects():
    from matbodh_dashboard.cards.translate import merge_results
    a = {"rows": [1], "contract": {"resolved_datasets": {"o1": "a"}, "coverage": "x"}, "context_status": {"o1": 1}}
    b = {"rows": [2], "contract": {"resolved_datasets": {"o2": "b"}, "coverage": "y"}, "context_status": {"o2": 2}}
    out = merge_results([a, b])
    assert out["rows"] == [1, 2]
    assert out["contract"] == {"resolved_datasets": {"o1": "a", "o2": "b"}, "coverage": "x"}
    assert out["context_status"] == {"o1": 1, "o2": 2}
    assert a["rows"] == [1]  # inputs are not changed
