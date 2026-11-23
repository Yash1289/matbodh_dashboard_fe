"""Configure descriptors: one per family, in step with CardConfig (spec 6a, sections 5 and 6)."""

from __future__ import annotations

import types
import typing

from pydantic import BaseModel

from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.configure.descriptor import DISPLAY_OR_GENERATED, Condition
from matbodh_dashboard.cards.configure.families import descriptors
from tests.api.test_app import client, parts, service  # noqa: F401  (fixtures)

# Paths a widget writes as one value (lists, and the benchmark reference object).
ATOMIC = {"scenarios", "cuts", "filters", "display_parties", "comparison.delta_measures",
          "rank.partition_by", "rank.filters", "benchmark.grouping_sets", "benchmark.reference",
          "benchmark.contenders"}

COMPARE = {"comparison.mode", "comparison.target.round", "comparison.target.scenario",
           "comparison.reference.round", "comparison.reference.scenario"}
SURVEY = {"anchor_round", "compare_round"}
EXPECTED = {
    "distribution": {*SURVEY, "surveys", "title", "scenarios", "all_party_scenarios", *COMPARE, "comparison.delta_measures",
                     "cuts", "filters", "caste_clubbing", "pipe_rounds", "display_parties"},
    "opinion": {*SURVEY, "surveys", "title", "scenarios", *COMPARE, "comparison.delta_measures", "cuts", "filters",
                "caste_clubbing", "pipe_rounds"},
    "gender_differential": {"anchor_round", "surveys", "title", "scenarios", "comparison.mode", "cuts", "filters", "caste_clubbing",
                            "pipe_rounds", "display_parties"},
    "seat_ranking": {*SURVEY, "title", "scenarios", *COMPARE, "rank.level", "rank.metric", "rank.party_id",
                     "rank.partition_by", "rank.filters", "rank.top_k", "pipe_rounds"},
    "demographic_ranking": {*SURVEY, "title", "scenarios", *COMPARE, "rank.level", "rank.metric", "rank.party_id",
                            "rank.partition_by", "rank.top_k", "filters", "pipe_rounds"},
    "seat_benchmark": {*SURVEY, "title", "scenarios", "benchmark.reference", "benchmark.reference_scenario",
                       "benchmark.focal_party",
                       "benchmark.grouping_sets", "benchmark.contenders"},
    "relationship": {"title", "relationship.origin", "relationship.destination", "relationship.focal_party",
                     "relationship.include_recalled.origin", "relationship.include_recalled.destination",
                     "relationship.joint_weight.source", "relationship.joint_weight.scenario", "cuts",
                     "pipe_rounds"},
}
# Optional fields shown on first open: how the card is split and in which mode / against what.
PRIMARY_OPTIONAL = {"anchor_round", "surveys", "comparison.mode", "cuts", "benchmark.reference", "benchmark.grouping_sets"}


def _models(annotation):
    """The pydantic models inside an annotation such as `X | None`."""
    args = typing.get_args(annotation) if isinstance(annotation, types.UnionType) or typing.get_origin(
        annotation) is typing.Union else (annotation,)
    return [a for a in args if isinstance(a, type) and issubclass(a, BaseModel)]


def leaf_paths(model: type[BaseModel] = CardConfig, prefix: str = "") -> set[str]:
    out: set[str] = set()
    for name, info in model.model_fields.items():
        path = f"{prefix}{name}"
        if path in ATOMIC or any(path == d or path.startswith(d + ".") for d in DISPLAY_OR_GENERATED):
            out.add(path)
            continue
        annotation = info.annotation
        if typing.get_origin(annotation) is dict:  # e.g. include_recalled: dict[Literal[...], ...]
            out |= {f"{path}.{key}" for key in typing.get_args(typing.get_args(annotation)[0])}
            continue
        nested = _models(annotation)
        if nested:
            for sub in nested:
                out |= leaf_paths(sub, path + ".")
        else:
            out.add(path)
    return out


def by_family():
    return {d.family: d for d in descriptors()}


def field(family, path):
    return next(f for f in by_family()[family].fields if f.path == path)


def test_every_config_field_has_descriptor_or_is_exempt():
    leaves = leaf_paths()
    families = by_family()
    assert set(families) == set(EXPECTED)
    for family, descriptor in families.items():
        paths = [f.path for f in descriptor.fields]
        assert len(paths) == len(set(paths)), family
        assert set(paths) == EXPECTED[family], family
        assert set(paths) <= leaves, (family, set(paths) - leaves)  # every path exists on CardConfig
    exempt = {p for p in leaves if any(p == d or p.startswith(d + ".") for d in DISPLAY_OR_GENERATED)}
    assert leaves - exempt <= set().union(*EXPECTED.values())  # no CardConfig field is forgotten


def test_required_fields_are_primary():
    for descriptor in descriptors():
        for f in descriptor.fields:
            if f.required:
                assert f.tier == "primary", (descriptor.family, f.path)
            elif f.tier == "primary":
                assert f.path in PRIMARY_OPTIONAL, (descriptor.family, f.path)


def test_option_widgets_name_a_source_or_choices():
    for descriptor in descriptors():
        for f in descriptor.fields:
            if f.widget in ("scenario_picker", "metric_picker", "party_picker", "election_picker",
                            "filter_list", "cut_builder"):
                assert f.options is not None, (descriptor.family, f.path)
            if f.widget == "choice":
                assert (f.options is None) != (f.choices is None), (descriptor.family, f.path)


def dumped(family, path):
    show = field(family, path).show_when
    return None if show is None else show.model_dump(exclude_none=True)


def test_normative_conditions():
    for family in ("distribution", "opinion", "gender_differential"):
        assert dumped(family, "caste_clubbing") == {"op": "contains", "path": "cuts", "value": "caste"}
    assert dumped("relationship", "relationship.include_recalled.origin") == {
        "op": "kind_of", "path": "relationship.origin", "kind": "recalled"}
    assert dumped("relationship", "relationship.include_recalled.destination") == {
        "op": "kind_of", "path": "relationship.destination", "kind": "recalled"}
    assert dumped("opinion", "comparison.delta_measures") == {"op": "all", "of": [
        {"op": "equals", "path": "comparison.mode", "value": "compare"},
        {"op": "kind_of", "path": "comparison.target.scenario", "kind": "opinion"},
        {"op": "kind_of", "path": "comparison.reference.scenario", "kind": "opinion"}]}
    assert dumped("relationship", "relationship.joint_weight.scenario") == {
        "op": "equals", "path": "relationship.joint_weight.source", "value": "scenario"}
    for family in ("seat_ranking", "demographic_ranking"):
        assert dumped(family, "rank.party_id") == {"op": "equals", "path": "rank.metric", "value": "support_share"}
    for family in ("seat_ranking", "demographic_ranking"):
        assert dumped(family, "pipe_rounds") == {"op": "equals", "path": "comparison.mode", "value": "trend"}
    for family in ("distribution", "opinion", "gender_differential"):  # last N rounds, unless surveys are chosen
        assert dumped(family, "pipe_rounds") == {"op": "all", "of": [
            {"op": "equals", "path": "comparison.mode", "value": "trend"},
            {"op": "not", "of": {"op": "nonempty", "path": "surveys"}}]}
    assert dumped("relationship", "pipe_rounds") is None  # every round is its own matrix


def test_benchmark_comparison_survey_shows_only_when_the_reference_reads_it():
    # Empty reference means the comparison round; an election or "nothing" never reads a comparison survey.
    assert field("seat_benchmark", "compare_round").label == "Comparison survey"
    assert dumped("seat_benchmark", "compare_round") == {"op": "not", "of": {
        "op": "in", "path": "benchmark.reference.kind", "values": ["election", "none"]}}


def test_seat_type_is_never_offered():
    for descriptor in descriptors():
        for f in descriptor.fields:
            assert "segment" not in (f.options.source if f.options else "")


def test_gender_differential_has_no_compare_mode():
    assert field("gender_differential", "comparison.mode").choices == ["standalone", "trend"]


def test_conditions_parse_from_json():
    raw = {"op": "all", "of": [{"op": "not", "of": {"op": "nonempty", "path": "filters"}},
                               {"op": "in", "path": "comparison.mode", "values": ["standalone", "trend"]},
                               {"op": "count_at_least", "path": "scenarios", "n": 2}]}
    assert Condition.model_validate(raw).model_dump(exclude_none=True) == raw


def test_families_endpoint(client):  # noqa: F811
    listed = client.get("/configure/families").json()
    assert len(listed) == 7
    assert all(item["meta"]["family"] == item["family"] for item in listed)
    assert {item["family"] for item in listed} == set(EXPECTED)


def test_web_fixture_matches_descriptors():
    """The frontend tests render the descriptors the API serves; regenerate the fixture when this fails:
    .venv/Scripts/python.exe -c "import json; from matbodh_dashboard.cards.configure.families import descriptors;
    open('web/src/test/fixtures/configure_families.json','w',encoding='utf-8').write(
    json.dumps([d.model_dump(exclude_none=True) for d in descriptors()], indent=1)+'\n')"
    """
    import json
    from pathlib import Path

    fixture = Path(__file__).resolve().parents[2] / "web" / "src" / "test" / "fixtures" / "configure_families.json"
    assert json.loads(fixture.read_text(encoding="utf-8")) == [d.model_dump(exclude_none=True) for d in descriptors()]


def test_surveys_field_survives_an_unset_mode():
    """The panel prunes hidden fields before the mode default is written, so an unset mode must show Surveys."""
    from matbodh_dashboard.cards.configure.descriptor import Condition  # noqa: F401
    f = field("distribution", "surveys")
    # shown for every mode but compare, so an unset mode (standalone) shows it too
    assert f.show_when.model_dump() == {"op": "not", "of": {"op": "in", "path": "comparison.mode", "values": ["compare"]}}
