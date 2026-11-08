import pytest

from matbodh_dashboard.catalogue.labels import (
    RoundIdentity,
    parse_round,
    series_groups,
    short_labels,
)


def _r(name: str, cycle: str, n: int | None) -> RoundIdentity:
    return parse_round("UP", name, cycle, n)


def test_parse_plain():
    r = _r("2027 VS CAPI R1", "2027 VS", 1)
    assert (r.series, r.round, r.base_name) == ("CAPI", 1, "2027 VS CAPI R1")
    assert (r.state, r.cycle) == ("UP", "2027 VS")


def test_parse_extrapolated_suffix():
    r = _r("2027 VS CAPI R2 (Extrapolated)", "2027 VS", 2)
    assert r.base_name == "2027 VS CAPI R2"
    assert r.series == "CAPI"


def test_parse_rebel_series():
    assert _r("2027 VS CAPI REBEL R1", "2027 VS", 1).series == "CAPI REBEL"


def test_parse_no_round():
    r = _r("2027 VS CAPI ST", "2027 VS", None)
    assert r.round is None
    assert r.series == "CAPI ST"


def test_sort_key():
    assert _r("2027 VS CAPI R2", "2027 VS", 2).sort_key == (2027, "VS", "CAPI", 2)
    assert _r("2027 VS CAPI ST", "2027 VS", None).sort_key == (2027, "VS", "CAPI ST", 0)


def test_short_labels_single_series():
    rs = [_r("2027 VS CAPI R1", "2027 VS", 1), _r("2027 VS CAPI R2", "2027 VS", 2)]
    labels = short_labels(rs)
    assert [labels[r] for r in rs] == ["R1", "R2"]


def test_short_labels_multiple_series_one_cycle():
    rs = [_r("2027 VS CAPI R1", "2027 VS", 1), _r("2027 VS CAPI REBEL R1", "2027 VS", 1)]
    labels = short_labels(rs)
    assert [labels[r] for r in rs] == ["CAPI R1", "CAPI REBEL R1"]


def test_short_labels_mixed_cycles():
    rs = [_r("2022 VS CAPI R4", "2022 VS", 4), _r("2027 VS CAPI R2", "2027 VS", 2)]
    labels = short_labels(rs)
    assert [labels[r] for r in rs] == ["22 CAPI R4", "27 CAPI R2"]


def test_series_groups_order():
    r27_2 = _r("2027 VS CAPI R2", "2027 VS", 2)
    r22_4 = _r("2022 VS CAPI R4", "2022 VS", 4)
    r27_1 = _r("2027 VS CAPI R1", "2027 VS", 1)
    groups = series_groups([r27_2, r22_4, r27_1])
    assert [h for h, _ in groups] == ["2022 VS · CAPI", "2027 VS · CAPI"]
    assert groups[1][1] == [r27_1, r27_2]


def test_short_labels_same_year_different_cycle_suffix():
    rs = [_r("2027 VS CAPI R1", "2027 VS", 1), _r("2027 LS CAPI R1", "2027 LS", 1)]
    labels = short_labels(rs)
    assert [labels[r] for r in rs] == ["27 VS CAPI R1", "27 LS CAPI R1"]


def test_short_labels_same_year_collision_keeps_other_years_short():
    rs = [
        _r("2022 VS CAPI R1", "2022 VS", 1),
        _r("2027 VS CAPI R1", "2027 VS", 1),
        _r("2027 LS CAPI R1", "2027 LS", 1),
    ]
    labels = short_labels(rs)
    assert [labels[r] for r in rs] == ["22 CAPI R1", "27 VS CAPI R1", "27 LS CAPI R1"]


def test_short_labels_ambiguous_raises():
    a = parse_round("UP", "2027 VS CAPI R1", "2027 VS", 1)
    b = parse_round("MP", "2027 VS CAPI R1", "2027 VS", 1)
    with pytest.raises(ValueError, match="ambiguous"):
        short_labels([a, b])


def test_parse_round_name_not_starting_with_cycle_raises():
    with pytest.raises(ValueError):
        parse_round("UP", "2022 VS CAPI R1", "2027 VS", 1)
    with pytest.raises(ValueError):
        parse_round("UP", "2027 VSX CAPI R1", "2027 VS", 1)


def test_parse_round_cycle_without_year_raises():
    with pytest.raises(ValueError):
        parse_round("UP", "VS CAPI R1", "VS", 1)
