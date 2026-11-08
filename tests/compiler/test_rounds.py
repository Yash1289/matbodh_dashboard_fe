from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.compiler.rounds import resolve_rounds
from matbodh_dashboard.context import StateContext
from tests.fixtures.catalogue_rows import make_query

STATE = "Uttar Pradesh"


def _ctx(**kw):
    base = dict(state=STATE, level="ac", rounds=["2027 VS CAPI R2", "2027 VS CAPI R1"])
    base.update(kw)
    return StateContext(**base)


def test_missing_extrapolated_falls_back_to_normal():
    rounds = resolve_rounds(_ctx(), load_catalogue(make_query()))
    assert [r.obs_id for r in rounds] == ["o1", "o2"]
    assert [r.label for r in rounds] == ["R1", "R2"]
    r1, r2 = rounds
    assert r1.dataset.variant == "normal" and r1.fallback is True
    assert r2.dataset.variant == "extrapolated" and r2.fallback is False


def test_matched_uses_normal():
    rounds = resolve_rounds(_ctx(version_mode="matched"), load_catalogue(make_query()))
    assert all(r.dataset.variant == "normal" and r.fallback is False for r in rounds)


def test_ambiguous_short_labels_fall_back_to_base_names():
    from tests.fixtures.catalogue_rows import dataset_row, level_row

    # Same cycle, series and round number once the round token is removed:
    # both would be labelled "R1", so the full base names are used (as /surveys does).
    names = ["2027 VS CAPI R1", "2027 VS R1 CAPI"]
    rows = [dataset_row(n, round_number=1) for n in names]
    levels = [level_row(n, range(1, 10)) for n in names]
    cat = load_catalogue(make_query(rows, levels))
    rounds = resolve_rounds(_ctx(rounds=names), cat)
    assert sorted(r.label for r in rounds) == sorted(names)
