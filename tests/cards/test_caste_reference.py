"""Caste clubbing is keyed to the card's anchor round for every round the card reads."""
from matbodh_dashboard.cards.compile import compile_card
from matbodh_dashboard.cards.configure.families import descriptors
from matbodh_dashboard.cards.translate import only_observation
from matbodh_dashboard.catalogue.store import load_catalogue
from tests.cards.test_compile import (
    CM, FIELDS, PM, PRESET, R1, R2, R3, SCENARIOS, VS, _compile, _config, _ctx, dataset_row, level_row, make_query,
)

CUTS = [[], ["category", "caste"]]


def _reference(job):
    return job.config["request"]["caste_clubbing"]["reference_observation"]


def test_reference_is_anchor_in_standalone_and_in_compare():
    (job,) = _compile(_config(cuts=CUTS, caste_clubbing=True)).jobs
    assert _reference(job) == "o3"
    compare = _compile(_config(cuts=CUTS, caste_clubbing=True, comparison={
        "mode": "compare", "target": {"scenario": VS}, "reference": {"round": "compare", "scenario": VS}}))
    assert [_reference(j) for j in compare.jobs] == ["o3"]


def test_every_survey_job_uses_the_anchor_as_an_extra_observation():
    plan = _compile(_config(surveys=[R1, R2], cuts=CUTS, caste_clubbing=True))
    assert plan.unavailable == ()
    by_key = {job.key: job for job in plan.jobs}
    assert {k: [o["id"] for o in j.config["request"]["observations"]] for k, j in by_key.items()} == {
        "grid:o1": ["o1", "o3"], "grid:o2": ["o2", "o3"]}
    assert {_reference(j) for j in plan.jobs} == {"o3"}


def test_the_anchor_survey_among_the_surveys_is_not_added_twice():
    plan = _compile(_config(surveys=[R1, R3], cuts=CUTS, caste_clubbing=True))
    observations = {j.key: [o["id"] for o in j.config["request"]["observations"]] for j in plan.jobs}
    assert observations == {"grid:o1": ["o1", "o3"], "grid:o3": ["o3"]}


def test_a_survey_the_anchor_cannot_cover_makes_the_card_unavailable_and_names_both():
    # R1 did not ask cm_satisfaction; with R1 as the anchor, R2 and R3 cannot be clubbed by it.
    plan = _compile(_config(family="opinion", scenarios=[CM], surveys=[R2, R3], cuts=CUTS, caste_clubbing=True),
                    ctx=_ctx(anchor_round=R1))
    assert plan.jobs == ()
    reason = plan.unavailable[0][1]
    assert R1 in reason and CM in reason and R2 in reason


def test_a_trend_that_does_not_read_the_anchor_is_unavailable_and_names_it():
    plan = _compile(_config(comparison={"mode": "trend"}, surveys=[R1, R2], cuts=CUTS, caste_clubbing=True))
    assert plan.jobs == () and R3 in plan.unavailable[0][1]


def test_anchor_without_caste_is_unavailable_and_named():
    rows, levels = [], []
    for i, name in enumerate((R1, R2, R3), 1):
        fields = [f for f in FIELDS if not (name == R3 and f == "caste")]
        rows.append(dataset_row(name, round_number=i, level="ac", available_fields=fields,
                                available_scenarios=[*SCENARIOS]))
        levels.append(level_row(name, range(1, 381)))
    plan = compile_card(_config(cuts=[["caste"]], caste_clubbing=True, comparison={"mode": "trend"}),
                        _ctx(), load_catalogue(make_query(rows, levels)), PRESET)
    assert plan.jobs == ()
    assert any(R3 in reason for _, reason in plan.unavailable)


def test_extra_observation_rows_are_dropped_from_a_surveys_result():
    result = {"rows": [{"observation_id": "o1", "x": 1}, {"observation_id": "o3", "x": 2}],
              "populations": [{"observation_id": "o3"}], "contract": {"coverage": 1}, "context_status": {}}
    kept = only_observation(result, "o1")
    assert kept["rows"] == [{"observation_id": "o1", "x": 1}]
    assert kept["populations"] == [] and kept["contract"] == {"coverage": 1}


def test_club_small_castes_defaults_on_in_every_family_that_offers_it():
    offered = [f for d in descriptors() for f in d.fields if f.path == "caste_clubbing"]
    assert offered and all(f.default is True for f in offered)
