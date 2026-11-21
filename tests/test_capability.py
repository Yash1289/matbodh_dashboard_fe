import pytest

from matbodh_dashboard.capability import SEAT_SLICES, Capabilities, capabilities, card_blockers, template_blockers


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
def test_zone_and_state_allow_zone_party_zone_district(level):
    caps = capabilities(level)
    assert caps == Capabilities(frozenset({"zone", "party_zone", "district"}), frozenset(),
                                frozenset({"extrapolated"}))
    assert not caps.geo_slices & SEAT_SLICES


def test_unknown_level_rejected():
    with pytest.raises(ValueError):
        capabilities("district")


def test_mixed_ac_and_state_allows_overall_and_district_cuts_when_mixed_ok():
    assert card_blockers("state", [], ["ac", "state"], mixed_ok=True) == []
    assert card_blockers("state", ["district", "zone", "party_zone"], ["ac", "state"], mixed_ok=True) == []


def test_mixed_levels_blocked_when_not_mixed_ok():
    (reason,) = card_blockers("state", [], ["ac", "state"], mixed_ok=False)
    assert "different levels" in reason


def test_seat_identifiers_blocked_over_mixed_levels():
    reasons = card_blockers("state", ["ac_num"], ["ac", "state"], mixed_ok=True)
    assert any("Seat identifiers need surveys of one level" in r and "AC" in r and "STATE" in r for r in reasons)
    assert any("'ac_num'" in r and "STATE" in r for r in reasons)  # also not a state-level slice
    assert card_blockers("state", ["ac_num"], ["ac", "ac"], mixed_ok=True) == []
    assert card_blockers("state", ["pc_num"], ["pc"], mixed_ok=True) == []


def test_state_survey_alone_cannot_cut_by_seat_identifier():
    assert card_blockers("state", ["pc_num"], ["state"], mixed_ok=True)


def test_pc_with_ac_blocks_a_zone_cut():
    reasons = card_blockers("state", ["zone"], ["ac", "pc"], mixed_ok=True)
    assert any("'zone'" in r and "PC" in r for r in reasons)


def test_min_level_is_checked_for_every_level_read():
    reasons = card_blockers("ac", [], ["ac", "state"], mixed_ok=True)
    assert len(reasons) == 1 and "STATE level" in reasons[0]


def test_single_level_template_blockers_unchanged():
    assert any("district" in r for r in template_blockers("state", ["district"], "pc"))
    assert template_blockers("state", ["party_zone"], "ac") == []
