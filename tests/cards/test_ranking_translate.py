import copy

import pytest

from matbodh_dashboard.cards.ranking.translate import translate_ranked
from tests.cards.ranking_helpers import (
    PM, demographic_card, load_rank_sample, ranked_ctx, seat_card, variant)

ANCHOR_CTX = ranked_ctx("ranking.test", ["o2"], "o2")
TREND_CTX = ranked_ctx("ranking.test", ["o1", "o2"], "o2")
TREND = {"mode": "trend"}


def _values(payload, entity):
    return {r.round: r for r in payload.ranks if r.entity == entity}


def test_seat_standalone_maps_every_row():
    sample = load_rank_sample("result_rank.json")
    payload = translate_ranked(seat_card(), {"o2": sample}, ANCHOR_CTX)
    assert payload.kind == "ranked" and payload.entity_kind == "seat"
    assert len(payload.entities) == 403 and len(payload.ranks) == 403
    first = payload.entities[0]
    assert first.labels["seat_id"] == "128"
    value = _values(payload, first.key)["o2"]
    assert (value.rank, value.value, value.status) == (1, 54.987736154245084, "available")
    assert payload.unit == "percentage_points" and payload.direction == "DESC"
    assert [g.partition for g in payload.groups] == [{}]
    assert payload.groups[0].eligible_count == {"o2": 403}
    assert payload.absent == []


def test_partitions_become_groups_and_compare_carries_reference():
    sample = load_rank_sample("result_rank_complex.json")
    card = seat_card(scenarios=[], comparison={
        "mode": "compare", "target": {"scenario": PM},
        "reference": {"round": "compare", "scenario": PM}},
        rank={"metric": "net_score", "level": "ac", "partition_by": ["party_zone"]})
    payload = translate_ranked(card, {"o2": sample}, ANCHOR_CTX)
    group = next(g for g in payload.groups
                 if g.partition == {"party_zone": "Big Leader Politics Belt"})
    assert group.eligible_count == {"o2": 32}
    row = next(r for r in sample["rows"] if r["seat_id"] == "274")
    value = next(r for r in payload.ranks if r.entity == "274")
    assert (value.rank, value.reference_value) == (row["rank"], row["reference_value"])
    ranks = [_values(payload, e)["o2"].rank for e in group.entities]
    assert ranks == sorted(ranks) and ranks[0] == 1


def test_every_number_comes_from_the_source():
    sample = load_rank_sample("result_rank_complex.json")
    payload = translate_ranked(seat_card(rank={"metric": "net_score", "level": "ac"}),
                               {"o2": sample}, ANCHOR_CTX)
    source = {v for row in sample["rows"] for v in row.values()
              if isinstance(v, (int, float)) and not isinstance(v, bool)}
    for rank in payload.ranks:
        for number in (rank.rank, rank.value, rank.target_value, rank.reference_value,
                       rank.target_base, rank.reference_base):
            assert number is None or number in source


def test_trend_rows_follow_the_anchor_and_look_up_later_rounds():
    sample = load_rank_sample("result_rank.json")
    results = {"o2": sample, "o1": variant(sample, drop_seats=("128",))}
    payload = translate_ranked(seat_card(comparison=TREND), results, TREND_CTX)
    assert payload.entities[0].labels["seat_id"] == "128"  # anchor rank 1 decides the order
    assert [(a.entity, a.round, a.reason) for a in payload.absent] == [("128", "o1", "not_ranked")]
    assert set(_values(payload, "129")) == {"o1", "o2"}


def test_top_k_absence_reason_is_outside_top_k():
    sample = load_rank_sample("result_rank.json")
    results = {"o2": sample, "o1": variant(sample, drop_seats=("128",))}
    card = seat_card(comparison=TREND, rank={"metric": "net_score", "level": "ac", "top_k": 5})
    payload = translate_ranked(card, results, TREND_CTX)
    assert [a.reason for a in payload.absent] == ["outside_top_k"]


def test_failed_round_is_round_failed_for_every_entity():
    sample = load_rank_sample("result_rank.json")
    payload = translate_ranked(seat_card(comparison=TREND), {"o2": sample}, TREND_CTX,
                               failed={"o1"})
    assert len(payload.absent) == 403
    assert {(a.round, a.reason) for a in payload.absent} == {("o1", "round_failed")}


def test_duplicate_entity_in_a_round_is_an_error():
    sample = load_rank_sample("result_rank.json")
    sample["rows"] = [sample["rows"][0], copy.deepcopy(sample["rows"][0])]
    with pytest.raises(ValueError, match="duplicate"):
        translate_ranked(seat_card(), {"o2": sample}, ANCHOR_CTX)


def test_ties_keep_the_engines_rows():
    sample = load_rank_sample("result_rank.json")
    sample["rows"] = sample["rows"][:4]
    for row, rank in zip(sample["rows"], (1, 1, 1, 4)):
        row["rank"] = rank
    card = seat_card(rank={"metric": "net_score", "level": "ac", "top_k": 2})
    payload = translate_ranked(card, {"o2": sample}, ANCHOR_CTX)
    assert [_values(payload, e.key)["o2"].rank for e in payload.entities] == [1, 1, 1, 4]


def test_demographic_rows():
    sample = load_rank_sample("result_seat_rank_demograph.json")
    payload = translate_ranked(demographic_card(), {"o2": sample}, ANCHOR_CTX)
    assert payload.entity_kind == "demographic" and payload.unit == "percentage"
    group = next(g for g in payload.groups if g.partition == {"ac_num": "1"})
    assert group.entities == ["caste=Other OBC", "caste=Nishad", "caste=Gujjar"]
    first = next(r for r in payload.ranks
                 if r.entity == "caste=Other OBC" and r.group == group.key)
    assert (first.rank, first.value, first.unweighted_base) == (1, 97.61311196810139, 44)
    assert first.weighted_denominator == 0.03506076502559401
    for g in payload.groups:
        distinct = {r.rank for r in payload.ranks if r.group == g.key}
        assert len(distinct) <= 3


def test_demographic_entity_missing_from_a_later_round_is_outside_top_k():
    sample = load_rank_sample("result_seat_rank_demograph.json")
    results = {"o2": sample, "o1": variant(sample, drop_rows=(0,))}
    card = demographic_card(comparison=TREND)
    payload = translate_ranked(card, results, TREND_CTX)
    assert [(a.entity, a.round, a.reason) for a in payload.absent] == [
        ("caste=Other OBC", "o1", "outside_top_k")]


def test_numeric_partitions_are_ordered_by_number_not_text():
    sample = load_rank_sample("result_seat_rank_demograph.json")
    payload = translate_ranked(demographic_card(), {"o2": sample}, ANCHOR_CTX)
    numbers = [int(g.partition["ac_num"]) for g in payload.groups]
    assert len(numbers) > 10 and numbers == sorted(numbers)
