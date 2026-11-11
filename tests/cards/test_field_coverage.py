import copy

import pytest

from matbodh_dashboard.cards.families import FAMILIES
from matbodh_dashboard.cards.field_map import (
    ROLES,
    load_field_map,
    parse_field_map,
    unmapped_keys,
)
from tests.cards.samples import FAMILY_SAMPLES, load_sample

CASES = [(family, name) for family, names in FAMILY_SAMPLES.items() for name in names]


@pytest.mark.parametrize(("family", "name"), CASES)
def test_every_sample_key_is_mapped(family, name):
    assert unmapped_keys(family, load_sample(name)) == []


def test_unknown_row_key_is_reported():
    result = copy.deepcopy(load_sample("result.json"))
    next(r for r in result["rows"] if r["outcome_domain"] == "party")["brand_new"] = 1
    assert unmapped_keys("distribution", result) == ["rows.brand_new"]


def test_unknown_top_level_key_is_reported():
    result = copy.deepcopy(load_sample("result.json"))
    result["surprise"] = 1
    assert unmapped_keys("distribution", result) == ["surprise"]


def test_items_owned_by_another_family_are_not_checked():
    result = copy.deepcopy(load_sample("result_ac_1_across.json"))
    next(r for r in result["rows"] if r["outcome_domain"] == "ordinal")["brand_new"] = 1
    assert unmapped_keys("distribution", result) == []
    assert unmapped_keys("opinion", result) == ["rows.brand_new"]


def test_ignored_needs_reason():
    raw = {"top": {}, "arrays": {"rows": {"roles": {"ignored": {"group_mask": ""}}}}}
    with pytest.raises(ValueError, match="reason"):
        parse_field_map(raw)


def test_unknown_role_is_rejected():
    raw = {"top": {}, "arrays": {"rows": {"roles": {"bogus": ["x"]}}}}
    with pytest.raises(ValueError, match="role"):
        parse_field_map(raw)


# Ranking families have no lenses and no field map.
GRID_FAMILIES = sorted(name for name, spec in FAMILIES.items() if spec.lenses)


@pytest.mark.parametrize("family", GRID_FAMILIES)
def test_every_role_is_known(family):
    for keys in load_field_map(family).values():
        assert set(keys.values()) <= ROLES


@pytest.mark.parametrize("family", GRID_FAMILIES)
def test_every_lens_field_is_mapped_as_lens(family):
    field_map = load_field_map(family)
    for source in FAMILIES[family].lens_sources.values():
        assert field_map[source.array][source.field] == "lens"


# --- ranking samples: every engine row key is either read or explicitly ignored ---------
RANK_ROW_KEYS_READ = {
    "seat_id", "partition", "metric_value", "target_value", "reference_value", "target_base",
    "reference_base", "metric_status", "rank", "eligible_seat_count", "direction", "unit",
    "weighted_denominator", "unweighted_base", "dimensions",
}
RANK_ROW_KEYS_IGNORED = {
    "pool": "JSON copy of partition",
    "seat_rows": "audit count of respondent-seat rows",
    "ranking_id": "one ranking per result; the card id replaces it",
    "seat_level": "the card's rank.level",
    "observation_id": "the round comes from the job key",
    "survey_id": "audit identity, kept in the contract",
    "grouping_set_id": "the operation owns grouping",
    "group_mask": "the operation owns grouping",
}
SEAT_RANK_SAMPLES = ("result_rank.json", "result_rank_complex.json", "result_rank_comp.json",
                     "result_rank_filtd.json")


@pytest.mark.parametrize("name", [*SEAT_RANK_SAMPLES, "result_seat_rank_demograph.json"])
def test_every_ranking_sample_key_is_read_or_ignored(name):
    from matbodh_dashboard.cards.ranking.translate import translate_ranked
    from tests.cards.ranking_helpers import (
        demographic_card, ranked_ctx, seat_card)

    sample = load_sample(name)
    keys = {k for row in sample["rows"] for k in row}
    assert keys <= RANK_ROW_KEYS_READ | set(RANK_ROW_KEYS_IGNORED), (
        sorted(keys - RANK_ROW_KEYS_READ - set(RANK_ROW_KEYS_IGNORED)))
    card = demographic_card() if name == "result_seat_rank_demograph.json" else seat_card()
    payload = translate_ranked(card, {"o2": sample}, ranked_ctx("c", ["o2"], "o2"))
    assert payload.contracts["o2"] == sample["contract"]  # the contract passes through whole
