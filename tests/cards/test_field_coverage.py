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
