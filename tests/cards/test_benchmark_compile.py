from __future__ import annotations

from pathlib import Path

import pytest

from matbodh_dashboard.cards.benchmark.parties import AllianceUnavailable, ElectionOption
from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
from matbodh_dashboard.cards.compile import compile_card
from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import load_preset
from tests.fixtures.catalogue_rows import SCENARIOS, dataset_row, level_row, make_query

ROOT = Path(__file__).resolve().parents[2]
PRESET = load_preset(ROOT / "config/presets/uttar-pradesh.standard-v1.yaml")
STATE = "Uttar Pradesh"
R1, R2 = "2027 VS CAPI R1", "2027 VS CAPI R2"
VS = "vs_voting_intention"
FIELDS = ["age_group", "gender", "ac_num", "pc_num", "party_zone", "category", "caste"]
ELECTIONS = {STATE: [ElectionOption(year=2022, election_type="VS", label="2022 VS"),
                     ElectionOption(year=2009, election_type="LS", label="2009 LS")]}
MAJORS = ["BSP", "NDA", "SP+"]


class FakeParties:
    """Survey mapping gives NDA/SP+/BSP; 2022 VS also maps INDI; 2009 LS has no context."""

    def identities(self, state, reporting_type, *, year=None, election_type=None):
        assert reporting_type == "MatBodh"
        if year is None:
            return frozenset({"NDA", "SP+", "BSP"})
        if (year, election_type) == (2022, "VS"):
            return frozenset({"NDA", "SP+", "BSP", "INDI"})
        raise ValueError(f"Expected one state-level alliance context for {state}, found 0")


def _catalogue(level="ac"):
    rows = [dataset_row(f"2027 VS CAPI R{i}", round_number=i, level=level, available_fields=FIELDS,
                        available_scenarios=list(SCENARIOS)) for i in (1, 2)]
    levels = [level_row(f"2027 VS CAPI R{i}", range(1, 404)) for i in (1, 2)]
    return load_catalogue(make_query(rows, levels))


def _ctx(compare=R1, level="ac"):
    return StateContext(state=STATE, level=level, rounds=[R1, R2], compare_round=compare)


def _card(table="comparison", focal="NDA", **overrides) -> CardConfig:
    data = {"id": "benchmark.test", "family": "seat_benchmark", "section": "benchmarks", "title": "T",
            "scenarios": [VS], "benchmark": {"focal_party": focal, "grouping_sets": [[], ["party_zone"]]},
            "view": {"table": table}}
    data.update(overrides)
    return CardConfig.model_validate(data)


def _compile(card=None, ctx=None, reference=None, parties=FakeParties(), elections=ELECTIONS, level="ac"):
    return compile_card(card or _card(), ctx or _ctx(level=level), _catalogue(level), PRESET,
                        reference=reference, parties=parties, elections=elections)


def test_survey_vs_survey_job_config_matches_the_engine_example_shape():
    plan = _compile(reference=BenchmarkReference(kind="compare"))
    assert plan.unavailable == ()
    (job,) = plan.jobs
    assert (job.key, job.kind, job.part) == ("benchmark", "benchmark", "grid")
    assert job.config["benchmark"] == {
        "id": "benchmark", "seat_level": "ac",
        "target": {"source": "survey", "id": "target", "observation": "o2", "scenario": VS},
        "reference": {"source": "survey", "id": "reference", "observation": "o1", "scenario": VS},
        "contenders": MAJORS, "focal_party": "NDA", "grouping_sets": [[], ["party_zone"]],
        "filters": [], "seat_ids": [], "competition_excluded": ["NOTA"],
    }
    request = job.config["request"]
    assert [o["id"] for o in request["observations"]] == ["o1", "o2"]
    assert request["scenarios"] == [VS] and request["grouping_sets"] == []
    assert request["parties"]["other_grouping"] == {"keep": MAJORS, "label": "Other"}
    assert job.config["alliances"] == {"reporting_type": "MatBodh"}


def test_election_reference_endpoint_passthrough_and_union_of_majors():
    plan = _compile(reference=BenchmarkReference(kind="election", year=2022, election_type="VS"))
    assert plan.unavailable == ()
    (job,) = plan.jobs
    union = ["BSP", "INDI", "NDA", "SP+"]
    benchmark = job.config["benchmark"]
    assert benchmark["contenders"] == union
    assert benchmark["reference"] == {
        "source": "election", "id": "reference", "context": {"year": 2022, "election_type": "VS"},
        "parties": {"passthrough": True, "options": [],
                    "other_grouping": {"keep": union, "label": "Other"}}}
    assert job.config["request"]["parties"]["other_grouping"]["keep"] == union
    assert [o["id"] for o in job.config["request"]["observations"]] == ["o2"]


def test_no_reference_has_no_reference_endpoint():
    (job,) = _compile(reference=BenchmarkReference(kind="none")).jobs
    assert job.config["benchmark"]["reference"] is None
    assert [o["id"] for o in job.config["request"]["observations"]] == ["o2"]


def test_default_reference_is_the_compare_round_when_the_context_has_one():
    (with_compare,) = _compile().jobs
    assert with_compare.config["benchmark"]["reference"]["observation"] == "o1"
    (without,) = _compile(ctx=_ctx(compare=None)).jobs
    assert without.config["benchmark"]["reference"] is None


@pytest.mark.parametrize("kwargs, expected", [
    ({"parties": None}, "not configured"),
    ({"reference": BenchmarkReference(kind="election", year=1999, election_type="LS")}, "not listed"),
    ({"reference": BenchmarkReference(kind="election", year=2009, election_type="LS")},
     "Expected one state-level alliance context"),
    ({"ctx": _ctx(compare=None), "reference": BenchmarkReference(kind="compare")}, "comparison round"),
    ({"ctx": _ctx(compare=R2), "reference": BenchmarkReference(kind="compare")}, "anchor"),
    ({"card": _card(focal="INC")}, "Other"),
    # INDI is mapped for 2022 VS only: the survey side's margins would be the engine's zero.
    ({"card": _card(focal="INDI"),
      "reference": BenchmarkReference(kind="election", year=2022, election_type="VS")}, "every endpoint"),
    ({"level": "zone"}, "AC- or PC-level"),
])
def test_unavailable_reasons_before_any_run(kwargs, expected):
    plan = _compile(**kwargs)
    assert plan.jobs == ()
    assert any(expected in reason for _, reason in plan.unavailable), plan.unavailable


class _Down:
    def identities(self, *a, **k):
        raise AllianceUnavailable("connection to 10.0.0.5 refused")


class _OtherNamed:
    """An alliance mapping that happens to contain the label the engine uses for the Other row."""

    def identities(self, *a, **k):
        return frozenset({"NDA", "SP+", PRESET.other_label})


def test_an_unreachable_alliance_table_is_unavailable_without_the_raw_error():
    plan = _compile(parties=_Down())
    assert plan.jobs == ()
    (_, reason), = plan.unavailable
    assert "could not be loaded" in reason and "10.0.0.5" not in reason


def test_a_major_party_named_like_the_other_row_is_refused():
    plan = _compile(card=_card(focal=None), parties=_OtherNamed())
    assert plan.jobs == ()
    assert any(PRESET.other_label in reason and "Other" in reason for _, reason in plan.unavailable)


def test_pc_level_compiles_with_the_pc_seat_level():
    # The engine host loads the AC-to-PC membership itself, so the config only names the level.
    (job,) = _compile(level="pc", reference=BenchmarkReference(kind="none")).jobs
    assert job.config["benchmark"]["seat_level"] == "pc"


def test_view_only_difference_gives_identical_job_config():
    a = _compile(card=_card(table="comparison"))
    b = _compile(card=_card(table="flips", id="benchmark.copy"))  # another card id and view
    assert a.jobs[0].config == b.jobs[0].config  # so the runner shares one fingerprint
