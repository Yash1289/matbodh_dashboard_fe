import copy

from matbodh_dashboard.cards.relationship.translate import translate_relationship
from tests.cards.relationship_helpers import (
    FOCAL, JOB, MAJORS, job_without_focal, load_transition, relationship_card, relationship_ctx,
    relationship_rules,
)

CTX_IDS = (["R1", "R2"], "R2")


def _translate(tmp_path, result=None, job=JOB, card=None, hide_other=True):
    ctx = relationship_ctx(*CTX_IDS, rules=relationship_rules(tmp_path, hide_other=hide_other))
    return translate_relationship(card or relationship_card(), result or load_transition(), job, MAJORS, ctx)


def _summary(payload, round_, gender):
    return next(s for s in payload.summaries if s.round == round_ and s.group.dimensions == {"gender": gender})


def _cells(payload, round_, gender):
    return [c for c in payload.cells if c.round == round_ and c.group.dimensions == {"gender": gender}]


def test_summary_copies_engine_values(tmp_path):
    s = _summary(_translate(tmp_path), "R2", "Male")
    assert s.retention_share == 74.01705783351689
    assert s.net_flow_pp == -7.806042401667394
    assert s.gained_population_share == 5.1893381577919575
    assert s.lost_population_share == 12.995380559459353
    assert s.acquisition_share == 12.29438668589424
    assert s.focal_origin_base == 244.80473394540334
    assert s.paired_count == 211641
    # a wrong-base implementation (retained over the paired base) would not equal the engine's value
    assert s.retention_share != 100 * s.retained_mass / s.paired_base


def test_matrix_cells_are_major_by_major_only_and_include_the_diagonal(tmp_path):
    payload = _translate(tmp_path)
    assert all(c.origin in MAJORS and c.destination in MAJORS for c in payload.cells)
    male = _cells(payload, "R2", "Male")
    assert len(male) == 9 and {(c.origin, c.destination) for c in male} == {(o, d) for o in MAJORS for d in MAJORS}
    assert any(c.origin == c.destination == FOCAL for c in male)
    sample = load_transition()
    assert any(r["origin_party"] not in MAJORS or r["destination_party"] not in MAJORS
               for r in sample["rows"])  # non-major rows were in the input and were dropped


def test_cell_numbers_come_from_the_matching_engine_row(tmp_path):
    sample = load_transition()
    row = next(r for r in sample["rows"] if r["observation_id"] == "R2"
               and r["dimensions"]["gender"]["value"] == "Male"
               and (r["origin_party"], r["destination_party"]) == ("BJP+", "SP+"))
    cell = next(c for c in _cells(_translate(tmp_path), "R2", "Male")
                if (c.origin, c.destination) == ("BJP+", "SP+"))
    for name in ("origin_share", "destination_share", "joint_share", "size_of_impact_pp", "joint_count",
                 "joint_mass", "origin_base", "destination_base", "paired_base", "paired_count"):
        assert getattr(cell, name) == row[name], name
    assert cell.absent is None


def test_absent_cell_is_a_dash_with_the_reason(tmp_path):
    sample = load_transition()
    sample["rows"] = [r for r in sample["rows"] if not (
        r["observation_id"] == "R2" and r["dimensions"]["gender"]["value"] == "Male"
        and (r["origin_party"], r["destination_party"]) == ("BJP+", "SP+"))]
    cells = _cells(_translate(tmp_path, sample), "R2", "Male")
    absent = [c for c in cells if c.absent is not None]
    assert [(c.origin, c.destination) for c in absent] == [("BJP+", "SP+")]
    assert absent[0].absent == "no_respondents"
    assert all(getattr(absent[0], n) is None for n in (
        "origin_share", "destination_share", "joint_share", "size_of_impact_pp", "joint_count",
        "joint_mass", "origin_base", "destination_base", "paired_base", "paired_count"))
    assert all(c.joint_share is not None for c in cells if c.absent is None)


def test_a_group_with_no_major_rows_still_exists_with_nine_absent_cells(tmp_path):
    sample = load_transition()
    sample["rows"] = [r for r in sample["rows"] if not (
        r["observation_id"] == "R2" and r["dimensions"]["gender"]["value"] == "Female")]
    payload = _translate(tmp_path, sample)
    female = _cells(payload, "R2", "Female")
    assert len(female) == 9 and all(c.absent == "no_respondents" for c in female)
    assert _summary(payload, "R2", "Female").retention_share is not None


def test_hidden_gender_value_is_dropped(tmp_path):
    hidden = _translate(tmp_path)
    assert {g.dimensions["gender"] for g in hidden.groups} == {"Female", "Male"}
    assert all(s.group.dimensions["gender"] != "Other" for s in hidden.summaries)
    assert all(c.group.dimensions["gender"] != "Other" for c in hidden.cells)
    shown = _translate(tmp_path, hide_other=False)  # the translator hides nothing by itself
    assert "Other" in {g.dimensions["gender"] for g in shown.groups}


def test_nothing_is_summed_or_computed(tmp_path):
    sample = load_transition()
    engine_floats = {r[n] for r in sample["rows"] for n in (
        "origin_share", "destination_share", "joint_share", "size_of_impact_pp", "origin_base",
        "destination_base", "paired_base", "joint_mass") if r[n] is not None}
    for cell in _translate(tmp_path).cells:
        for name in ("origin_share", "destination_share", "joint_share", "size_of_impact_pp"):
            value = getattr(cell, name)
            assert value is None or value in engine_floats


def test_without_a_focal_party_only_agreement_is_carried(tmp_path):
    sample = load_transition()
    focal_fields = ("retention_share", "loss_share", "acquisition_share", "conversion_share",
                    "retained_population_share", "lost_population_share", "gained_population_share",
                    "neither_population_share", "net_flow_pp", "focal_origin_base", "focal_destination_base",
                    "retained_mass", "lost_mass", "gained_mass", "neither_mass")
    for s in sample["summaries"]:
        for name in focal_fields:
            s.pop(name, None)
        s["focal_party"] = None
    payload = _translate(tmp_path, sample, job_without_focal(),
                         relationship_card(relationship={"origin": "vs_past", "destination": "vs_voting_intention"}))
    s = _summary(payload, "R2", "Male")
    assert s.agreement_share == 74.00382932932902
    assert all(getattr(s, n) is None for n in focal_fields)
    assert payload.focal_party is None


def test_parties_follow_the_rule_set_order(tmp_path):
    payload = _translate(tmp_path)
    assert payload.parties == ["BJP+", "SP+", "BSP"]
    assert [(c.origin, c.destination) for c in _cells(payload, "R2", "Male")][:3] == [
        ("BJP+", "BJP+"), ("BJP+", "SP+"), ("BJP+", "BSP")]


def test_empty_result_gives_an_empty_payload(tmp_path):
    empty = {"rows": [], "summaries": [], "populations": [], "contract": load_transition()["contract"]}
    payload = _translate(tmp_path, empty)
    assert payload.groups == [] and payload.cells == [] and payload.summaries == []


def test_contract_keeps_only_the_spec_keys(tmp_path):
    contract = _translate(tmp_path).contract
    assert "source_contracts" not in contract and "operations" not in contract
    for key in ("relationship", "identities", "joint_weights", "eligibility", "normalisations", "focal_bases",
                "population", "units", "cross_round_pairing"):
        assert key in contract
    assert contract["cross_round_pairing"] is False


def test_view_table_sets_the_default(tmp_path):
    assert _translate(tmp_path).default_table == "summary"
    matrix = relationship_card(view={"table": "matrix"})
    payload = _translate(tmp_path, card=matrix)
    assert payload.default_table == "matrix" and payload.tables_available == ["summary", "matrix"]


def test_payload_identity_fields(tmp_path):
    payload = _translate(tmp_path)
    assert (payload.kind, payload.family, payload.origin, payload.destination, payload.focal_party) == (
        "relationship", "relationship", "vs_past", "vs_voting_intention", FOCAL)
    assert payload.weights == load_transition()["contract"]["joint_weights"]
    assert copy.deepcopy(payload.model_dump())["groups"]
