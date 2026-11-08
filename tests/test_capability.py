import pytest

from matbodh_dashboard.capability import Capabilities, capabilities


def test_ac_capabilities():
    caps = capabilities("ac")
    assert caps.geo_slices == {"zone", "party_zone", "district", "pc_num", "ac_num"}
    assert caps.seat_levels == {"ac", "pc"}
    assert caps.version_modes == {"extrapolated", "matched"}


def test_pc_capabilities():
    caps = capabilities("pc")
    assert caps.geo_slices == {"pc_zone", "pc_num"}
    assert caps.seat_levels == {"pc"}
    assert caps.version_modes == {"extrapolated", "matched"}


@pytest.mark.parametrize("level", ["zone", "state"])
def test_zone_and_state_capabilities(level):
    caps = capabilities(level)
    assert caps == Capabilities(frozenset(), frozenset(), frozenset({"extrapolated"}))


def test_unknown_level_rejected():
    with pytest.raises(ValueError):
        capabilities("district")
