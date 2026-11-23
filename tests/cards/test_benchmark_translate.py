from __future__ import annotations

import copy
import json
from collections import defaultdict

import pytest

from matbodh_dashboard.cards.benchmark.translate import translate_benchmark
from matbodh_dashboard.cards.config import CardConfig
from tests.cards.benchmark_helpers import FIXTURE_ENDPOINT_IDS, FIXTURE_MAJORS, load_benchmark_sample
from tests.cards.ranking_helpers import ranked_ctx

VS = "vs_voting_intention"
SURVEY = frozenset(FIXTURE_MAJORS)


def card(table=None) -> CardConfig:
    data = {"id": "benchmark.test", "family": "seat_benchmark", "section": "benchmarks", "title": "T",
            "scenarios": [VS], "benchmark": {"focal_party": "NDA", "grouping_sets": [[], ["party_zone"]]}}
    if table:
        data["view"] = {"table": table}
    return CardConfig.model_validate(data)


def job_config(reference="election", focal="NDA") -> dict:
    other = {"keep": list(FIXTURE_MAJORS), "label": "Other"}
    ref = {"election": {"source": "election", "id": FIXTURE_ENDPOINT_IDS["reference"],
                        "context": {"year": 2022, "election_type": "VS"}},
           "none": None}[reference]
    return {"request": {"parties": {"other_grouping": other}},
            "benchmark": {"id": "benchmark.test", "contenders": list(FIXTURE_MAJORS), "focal_party": focal,
                          "target": {"source": "survey", "id": FIXTURE_ENDPOINT_IDS["target"],
                                     "observation": "o2", "scenario": VS},
                          "reference": ref}}


def translate(result=None, config=None, parties=None, view=None):
    config = config or job_config()
    parties = parties or {"target": SURVEY, "reference": SURVEY}
    return translate_benchmark(card(view), result or load_benchmark_sample(), config, parties,
                               ranked_ctx("benchmark.test", ["o1", "o2"], "o2"))


def test_values_are_copied_exactly():
    payload = translate()
    engine = next(r for r in load_benchmark_sample()["comparisons"]
                  if r["grouping_set_id"] == "g0" and r["party_id"] == "NDA")
    row = next(r for r in payload.comparisons if r.group.set_id == "g0" and r.party == "NDA")
    assert row.target_vote_share == engine["target_vote_share"]
    assert row.reference_vote_share == engine["reference_vote_share"]
    assert row.vote_share_delta_pp == engine["vote_share_delta_pp"]
    assert (row.target_seats, row.reference_seats, row.seat_delta) == (154, 273, -119)
    assert row.absent_sides == []


def test_other_row_is_present_and_numbers_are_the_engines():
    payload = translate()
    other = next(r for r in payload.comparisons if r.group.set_id == "g0" and r.party == "Other")
    assert other.reference_seats == 4
    assert other.vote_share_delta_pp == pytest.approx(-4.71, abs=0.01)
    survey_other = next(r for r in payload.summaries
                        if r.group.set_id == "g0" and r.party == "Other" and r.endpoint == "target")
    assert survey_other.seats == 0 and survey_other.absent is None  # a real zero, not a dash


def test_named_parties_plus_other_sum_to_100_per_group():
    totals: dict[tuple, list[float]] = defaultdict(lambda: [0.0, 0, 0])
    for r in translate().summaries:
        t = totals[(r.endpoint, r.group.set_id, json.dumps(r.group.dimensions, sort_keys=True))]
        t[0] += r.vote_share
        t[1] += r.seats
        t[2] = r.eligible_seats
    assert totals and all(v[0] == pytest.approx(100.0, abs=1e-6) and v[1] == v[2] for v in totals.values())


def test_party_missing_from_one_endpoint_is_a_dash_not_zero():
    result = copy.deepcopy(load_benchmark_sample())
    common = dict(grouping_set_id="g0", dimensions={}, party_id="INDI", eligible_seat_count=403)
    result["summaries"] += [
        dict(common, endpoint=FIXTURE_ENDPOINT_IDS["target"], seat_count=0, seat_share=0.0,
             support_mass=0.0, support_base=1021.6, vote_share=0.0),
        dict(common, endpoint=FIXTURE_ENDPOINT_IDS["reference"], seat_count=2, seat_share=0.5,
             support_mass=12.0, support_base=1000.0, vote_share=1.2)]
    result["comparisons"].append(dict(
        common, target_vote_share=0.0, reference_vote_share=1.2, vote_share_delta_pp=-1.2,
        target_seat_count=0, reference_seat_count=2, seat_count_delta=-2, seat_share_delta_pp=-0.5))
    payload = translate(result, parties={"target": SURVEY, "reference": SURVEY | {"INDI"}})
    target = next(r for r in payload.summaries if r.party == "INDI" and r.endpoint == "target")
    assert target.absent == "not_in_endpoint_mapping"
    assert (target.seats, target.vote_share, target.seat_share) == (None, None, None)
    reference = next(r for r in payload.summaries if r.party == "INDI" and r.endpoint == "reference")
    assert reference.absent is None and reference.vote_share == 1.2 and reference.seats == 2
    comparison = next(r for r in payload.comparisons if r.party == "INDI")
    assert comparison.absent_sides == ["target"]
    assert comparison.target_vote_share is None and comparison.target_seats is None
    assert comparison.vote_share_delta_pp is None and comparison.seat_delta is None
    assert comparison.reference_vote_share == 1.2


def test_tables_available_and_default_table():
    with_ref = translate()
    assert with_ref.tables_available == ["summary", "comparison", "margin_buckets", "flips"]
    assert with_ref.default_table == "comparison"
    no_ref_result = copy.deepcopy(load_benchmark_sample())
    no_ref_result["comparisons"], no_ref_result["flips"] = [], []
    for table in ("summaries", "margin_buckets", "seat_results"):  # a real run has no reference rows
        no_ref_result[table] = [r for r in no_ref_result[table] if r["endpoint"] == FIXTURE_ENDPOINT_IDS["target"]]
    without = translate(no_ref_result, config=job_config("none"), parties={"target": SURVEY}, view="flips")
    assert without.tables_available == ["summary", "margin_buckets"]
    assert without.default_table == "summary"  # the card's flips view cannot exist without a reference
    assert translate(view="flips").default_table == "flips"
    assert without.reference == {"kind": "none", "label": None}
    assert with_ref.reference == {"kind": "election", "label": "2022 VS"}


def test_another_question_on_the_comparison_survey_is_named_on_both_sides():
    config = job_config()
    config["benchmark"]["reference"] = {"source": "survey", "id": FIXTURE_ENDPOINT_IDS["reference"],
                                        "observation": "o2", "scenario": "ls_voting_intention"}
    payload = translate(config=config)
    assert payload.reference == {"kind": "compare", "label": "o2 · ls_voting_intention"}
    assert payload.anchor_question == VS
    config["benchmark"]["reference"]["scenario"] = VS  # the same question: the round labels say it all
    same = translate(config=config)
    assert same.reference == {"kind": "compare", "label": "o2"} and same.anchor_question is None


def test_party_order_follows_the_state_rule_not_the_alphabet():
    from dataclasses import replace
    from pathlib import Path

    from matbodh_dashboard.registry import load_rules

    rules = load_rules(Path(__file__).resolve().parents[2] / "config" / "presentation")
    config = job_config()
    config["benchmark"]["contenders"] = ["BSP", "INDI", "NDA", "SP+"]
    ctx = replace(ranked_ctx("benchmark.test", ["o1", "o2"], "o2"), rules=rules)
    payload = translate_benchmark(card(), load_benchmark_sample(), config, {"target": SURVEY, "reference": SURVEY}, ctx)
    # NDA, SP+, BSP are listed for Uttar Pradesh; INDI follows them; Other is the payload's own last row.
    assert payload.parties == ["NDA", "SP+", "BSP", "INDI"]


def test_payload_carries_the_majors_other_label_and_no_seat_rows():
    payload = translate()
    dumped = payload.model_dump()
    assert payload.kind == "benchmark" and payload.parties == list(FIXTURE_MAJORS)
    assert payload.other_label == "Other" and payload.focal_party == "NDA"
    assert payload.endpoint_parties == {"target": list(FIXTURE_MAJORS), "reference": list(FIXTURE_MAJORS)}
    assert "seat_results" not in dumped and "coverage" not in dumped
    assert "completed_acs" not in json.dumps(dumped["contract"])
