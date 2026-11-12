import pytest
from pydantic import ValidationError

from matbodh_dashboard.cards.families import FAMILIES, family_meta, get_family
from matbodh_dashboard.cards.payload import CellValue


@pytest.mark.parametrize("name", sorted(FAMILIES))
def test_lens_ids_unique_per_family(name):
    ids = [lens.id for lens in FAMILIES[name].lenses]
    assert len(ids) == len(set(ids))


# Ranking families have one fixed metric and no lenses.
GRID_FAMILIES = sorted(name for name, spec in FAMILIES.items() if spec.lenses)


@pytest.mark.parametrize("name", GRID_FAMILIES)
def test_default_lens_is_a_lens(name):
    spec = FAMILIES[name]
    assert spec.default_lens in {lens.id for lens in spec.lenses}


@pytest.mark.parametrize("name", sorted(FAMILIES))
def test_every_lens_has_exactly_one_source(name):
    spec = FAMILIES[name]
    assert set(spec.lens_sources) == {lens.id for lens in spec.lenses}


def test_all_families_exist():
    assert set(FAMILIES) == {"distribution", "opinion", "gender_differential",
                             "seat_ranking", "demographic_ranking", "seat_benchmark"}
    assert set(GRID_FAMILIES) == {"distribution", "opinion", "gender_differential"}


def test_gender_differential_has_no_compare_mode():
    assert FAMILIES["gender_differential"].capabilities.modes == ["standalone", "trend"]
    assert FAMILIES["distribution"].capabilities.modes == ["standalone", "compare", "trend"]
    assert FAMILIES["opinion"].capabilities.modes == ["standalone", "compare", "trend"]


@pytest.mark.parametrize("name", sorted(FAMILIES))
def test_delta_lenses_name_a_delta_source(name):
    spec = FAMILIES[name]
    for lens in spec.lenses:
        source = spec.lens_sources[lens.id]
        if lens.has_delta:
            assert source.delta_measure and source.delta_field
        else:
            assert source.delta_measure is None and source.delta_field is None
    if name == "gender_differential":
        assert not any(lens.has_delta for lens in spec.lenses)


def test_distribution_lens_sources_follow_the_engine_guides():
    sources = FAMILIES["distribution"].lens_sources
    assert sources["support_share"].array == "rows"
    assert sources["support_share"].domain == ("party",)
    assert sources["size_of_impact_pp"].delta_field == "size_of_impact_pp"
    assert sources["support_share"].delta_field == "percentage_point_difference"
    unit = {lens.id: lens.unit for lens in FAMILIES["distribution"].lenses}
    assert unit["size_of_impact_pp"] == "percentage_points"
    assert unit["support_share"] == "percentage"


def test_opinion_option_lens_reads_rows_not_scores():
    source = FAMILIES["opinion"].lens_sources["option_support_share"]
    assert source.array == "rows" and source.domain == ("ordinal", "boolean")
    assert FAMILIES["opinion"].lens_sources["net_score"].array == "scores"


def test_get_family_unknown_raises():
    with pytest.raises(KeyError):
        get_family("ranking")


def test_family_meta_lists_every_lens():
    spec = get_family("opinion")
    meta = family_meta(spec)
    assert [lens.id for lens in meta.lenses] == [lens.id for lens in spec.lenses]
    assert meta.default_lens == spec.default_lens and meta.family == "opinion"


def test_payload_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        CellValue(row="r", column="c", round=None, lens="support_share", value=1.0,
                  status="available", surprise=True)


def test_relationship_family_is_registered_without_lenses():
    spec = get_family("relationship")
    assert spec.lenses == () and spec.default_lens == ""
    assert family_meta(spec).capabilities.modes == ["standalone", "trend"]
