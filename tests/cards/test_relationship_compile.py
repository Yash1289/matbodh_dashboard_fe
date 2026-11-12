from __future__ import annotations

from pathlib import Path

import pytest

from matbodh_dashboard.cards.benchmark.parties import AllianceUnavailable
from matbodh_dashboard.cards.compile import compile_card
from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import load_preset
from tests.fixtures.catalogue_rows import dataset_row, level_row, make_query

ROOT = Path(__file__).resolve().parents[2]
PRESET = load_preset(ROOT / "config/presets/uttar-pradesh.standard-v1.yaml")
STATE = "Uttar Pradesh"
R1, R2 = "2027 VS CAPI R1", "2027 VS CAPI R2"
BOTH = ["vs_past", "vs_voting_intention", "mla_choice_party"]
FIELDS = ["age_group", "gender", "ac_num", "pc_num", "party_zone", "category", "caste"]


class FakeParties:
    def identities(self, state, reporting_type, *, year=None, election_type=None):
        assert reporting_type == "MatBodh" and year is None
        return frozenset({"NDA", "SP+", "BSP"})


def _catalogue(level="ac", scenarios=(BOTH, BOTH), fields=FIELDS):
    rows = [dataset_row(f"2027 VS CAPI R{i}", round_number=i, level=level, available_fields=list(fields),
                        available_scenarios=list(scenarios[i - 1])) for i in (1, 2)]
    levels = [level_row(f"2027 VS CAPI R{i}", range(1, 404)) for i in (1, 2)]
    return load_catalogue(make_query(rows, levels))


def _ctx(level="ac", **over):
    return StateContext(**{"state": STATE, "level": level, "rounds": [R1, R2], "compare_round": R1, **over})


def _card(**over) -> CardConfig:
    data = {"id": "relationship.t", "family": "relationship", "section": "relationships", "title": "T",
            "cuts": [[], ["gender"]],
            "relationship": {"origin": "vs_past", "destination": "vs_voting_intention", "focal_party": "NDA"},
            "view": {"table": "summary"}}
    data.update(over)
    return CardConfig.model_validate(data)


def _compile(card=None, ctx=None, parties=FakeParties(), catalogue=None):
    return compile_card(card or _card(), ctx or _ctx(), catalogue or _catalogue(), PRESET, parties=parties)


def test_job_config_shape():
    plan = _compile()
    assert plan.unavailable == () and plan.not_asked == ()
    (job,) = plan.jobs
    assert (job.key, job.kind, job.part) == ("relationship", "relationship", "grid")
    assert job.config["relationship"] == {
        "id": "relationship", "origin": "vs_past", "destination": "vs_voting_intention",
        "weights": {"source": "base"}, "focal_party": "NDA"}
    request = job.config["request"]
    assert [o["id"] for o in request["observations"]] == ["o1", "o2"]
    assert request["scenarios"] == ["vs_past", "vs_voting_intention"]
    assert request["grouping_sets"] == [[], ["gender"]]
    assert request["coverage_mode"] == "independent" and request["reference_observation"] is None
    assert request["comparisons"] == [] and request["gender_differential"] is None
    assert request["filters"] == [] and request["parties"]["other_grouping"] is None
    assert job.config["alliances"] == {"reporting_type": "MatBodh"}


def test_include_recalled_becomes_answer_overrides():
    rel = {"origin": "vs_past", "destination": "vs_voting_intention", "focal_party": "NDA",
           "include_recalled": {"origin": ["Did Not Vote", "Do Not Remember"]}}
    (job,) = _compile(_card(relationship=rel)).jobs
    assert job.config["relationship"]["answer_overrides"] == {
        "origin": {"include": ["Did Not Vote", "Do Not Remember"]}}


def test_no_focal_party_is_carried_as_none():
    rel = {"origin": "vs_past", "destination": "vs_voting_intention"}
    (job,) = _compile(_card(relationship=rel)).jobs
    assert job.config["relationship"]["focal_party"] is None


def test_view_only_difference_gives_identical_job_config():
    a = _compile(_card(view={"table": "summary"})).jobs[0].config
    b = _compile(_card(view={"table": "matrix"}, id="relationship.copy")).jobs[0].config
    assert a == b


@pytest.mark.parametrize("kwargs, expected", [
    ({"parties": None}, "not configured"),
    ({"card": _card(relationship={"origin": "vs_past", "destination": "vs_voting_intention",
                                  "focal_party": "INC"})}, "not a major party"),
    ({"catalogue": _catalogue(scenarios=(BOTH, ["vs_past"]))}, "was not asked in"),
    ({"card": _card(cuts=[["occupation"]])}, "needs to exist"),
    ({"ctx": _ctx(level="state"), "catalogue": _catalogue(level="state"),
      "card": _card(cuts=[["ac_num"]])}, "not available"),
])
def test_unavailable_reasons(kwargs, expected):
    plan = _compile(**kwargs)
    assert plan.jobs == ()
    assert any(expected in reason for _, reason in plan.unavailable), plan.unavailable


def test_a_round_without_a_scenario_is_not_asked():
    plan = _compile(catalogue=_catalogue(scenarios=(["vs_voting_intention"], BOTH)))
    assert plan.unavailable == ()
    (job,) = plan.jobs
    assert [o["id"] for o in job.config["request"]["observations"]] == ["o2"]
    assert plan.not_asked == (("grid", (R1,)),)


def test_alliance_unreadable_is_unavailable_without_the_raw_error():
    class Down:
        def identities(self, *a, **k):
            raise AllianceUnavailable("connection to 10.0.0.5 refused")

    plan = _compile(parties=Down())
    assert plan.jobs == ()
    (_, reason), = plan.unavailable
    assert "could not be loaded" in reason and "10.0.0.5" not in reason


def test_engine_verdict_is_shown():
    class NoContext:
        def identities(self, *a, **k):
            raise ValueError("Expected one state-level alliance context for UP, found 0")

    plan = _compile(parties=NoContext())
    assert any(reason.startswith("Alliance mapping:") for _, reason in plan.unavailable)
