from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.compiler.coverage import choose_coverage
from matbodh_dashboard.compiler.rounds import resolve_rounds
from matbodh_dashboard.context import StateContext
from tests.fixtures.catalogue_rows import LEVEL_ROWS, level_row, make_query


def _rounds(version_mode="extrapolated", **kw):
    ctx = StateContext(state="Uttar Pradesh", level="ac",
                       rounds=["2027 VS CAPI R1", "2027 VS CAPI R2"],
                       version_mode=version_mode)
    return resolve_rounds(ctx, load_catalogue(make_query(**kw)))


def _equal_levels():
    levels = [dict(r) for r in LEVEL_ROWS]
    levels[0] = level_row("2027 VS CAPI R1", range(1, 404))
    return levels


def test_geographic_slice_uses_common_when_coverage_differs():
    rounds = _rounds()  # R1 380 seats vs R2 403 seats
    assert choose_coverage(rounds, uses_seat_ids=False, geographic=True,
                           version_mode="extrapolated") == "common"


def test_geographic_slice_independent_when_coverage_equal():
    rounds = _rounds(level_rows=_equal_levels())
    assert choose_coverage(rounds, uses_seat_ids=False, geographic=True,
                           version_mode="extrapolated") == "independent"


def test_non_geographic_is_independent():
    assert choose_coverage(_rounds(), uses_seat_ids=False, geographic=False,
                           version_mode="extrapolated") == "independent"


def test_seat_ids_force_common():
    assert choose_coverage(_rounds(level_rows=_equal_levels()), uses_seat_ids=True,
                           geographic=False, version_mode="extrapolated") == "common"


def test_matched_geographic_is_common():
    assert choose_coverage(_rounds("matched", level_rows=_equal_levels()),
                           uses_seat_ids=False, geographic=True,
                           version_mode="matched") == "common"
