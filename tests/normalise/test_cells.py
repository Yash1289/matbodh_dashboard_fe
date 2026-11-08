from matbodh_dashboard.normalise.cells import (
    Cell, build_grid, build_opinion_cells, build_scoreboard,
)
from matbodh_dashboard.normalise.rows import NormalRow

SUB = (("party_zone", None, True),)


def nr(measure, series, value, obs="o1", dims=(), unit="pct", scenario=None, flags=()):
    return NormalRow("UP", obs, measure, series, dims, value, unit, None,
                     frozenset(flags), scenario)


def board(rows, **kw):
    args = dict(round_ids=["o0", "o1"], anchor="o1", compare="o0", keep=["BJP", "SP"],
                other_label="Other")
    args.update(kw)
    return {r.party: r for r in build_scoreboard(rows, **args)}


def test_seat_winner_outside_keep_list_gets_own_row():
    rows = [
        nr("support_share", "BJP", 41.5), nr("support_share", "SP", 30.0),
        nr("support_share", "Other", 5.0),
        # Ungrouped parties-job shares; JDL (3.0) is folded into Other above.
        nr("party_share", "BJP", 41.5), nr("party_share", "JDL", 3.0),
        nr("party_share", "INC", 2.0), nr("party_share", "Undecided", 1.5),
        nr("seats_ac", "JDL", 2, unit="seats"), nr("vote_share_bench", "JDL", 3.2),
        nr("seats_ac", "BJP", 200, unit="seats"),
    ]
    b = board(rows)
    # INC and Undecided only appear ungrouped: they stay inside Other.
    assert list(b) == ["BJP", "SP", "Other", "JDL"]
    jdl = b["JDL"]
    assert jdl.vote.value == 3.0  # the survey share, not the seat-view share
    assert jdl.vote.trend == (None, 3.0)
    assert "within_other" in jdl.vote.flags and "vote_from_seat_view" not in jdl.vote.flags
    assert jdl.flags == frozenset({"within_other"})
    assert jdl.vote.delta is None and "no_delta" in jdl.vote.flags  # no engine Δ for it
    assert jdl.seats_ac.value == 2
    assert jdl.seats_pc is None
    assert b["BJP"].vote.value == 41.5 and b["BJP"].flags == frozenset()


def test_not_asked_round_is_flagged_not_zero():
    b = board([nr("support_share", "BJP", 41.5), nr("support_share", "SP", 30.0, obs="o0"),
               nr("support_share", "SP", 31.0)])
    assert b["BJP"].vote.trend == (None, 41.5)
    assert "not_asked" in b["BJP"].vote.flags
    assert "not_asked" not in b["SP"].vote.flags


def test_delta_comes_from_engine_rows_only():
    rows = [nr("support_share", "BJP", 41.5), nr("support_share", "BJP", 41.0, obs="o0"),
            nr("delta_support", "BJP", 1.0, unit="pp")]
    cell = board(rows)["BJP"].vote
    assert cell.delta == 1.0 and cell.value == 41.5 and cell.trend == (41.0, 41.5)
    # no delta row -> None, never derived
    assert board(rows[:2])["BJP"].vote.delta is None


def test_non_party_has_no_seat_cell():
    b = board([nr("support_share", "BJP", 41.5), nr("support_share", "Undecided", 8.0)])
    u = b["Undecided"]
    assert u.vote.value == 8.0
    assert u.seats_ac.value is None and "not_contender" in u.seats_ac.flags
    assert u.seats_pc.value is None and "not_contender" in u.seats_pc.flags


def test_gender_secondary_text():
    rows = [nr("support_share", "BJP", 41.5), nr("gender_gap", "BJP", -4.0, unit="pp"),
            nr("female_share", "BJP", 39.5), nr("male_share", "BJP", 43.5)]
    g = board(rows)["BJP"].gender_gap
    assert g.value == -4.0 and g.secondary == "F 39.5 · M 43.5"


def test_by_zone_rows_excluded_from_scoreboard():
    rows = [nr("support_share", "BJP", 41.5),
            nr("support_share", "BJP", 60.0, dims=(("party_zone", "West", False),))]
    assert board(rows)["BJP"].vote.value == 41.5


def test_opinion_cells_by_scenario():
    rows = [
        nr("net_score", "pm", 12.0, scenario="pm", unit="pp"),
        nr("net_score", "pm", 8.0, obs="o0", scenario="pm", unit="pp"),
        nr("positive_share", "pm", 55.6, scenario="pm"),
        nr("negative_share", "pm", 43.4, scenario="pm"),
        nr("delta_net_score", "pm", 4.0, scenario="pm", unit="pp"),
        nr("net_score", "cm", -3.0, scenario="cm", unit="pp"),
    ]
    c = build_opinion_cells(rows, round_ids=["o0", "o1"], anchor="o1", compare="o0")
    assert c["pm"] == Cell(12.0, 4.0, (8.0, 12.0), "56 sat · 43 dis", frozenset())
    assert c["cm"].trend == (None, -3.0) and {"not_asked", "no_delta"} <= c["cm"].flags
    assert c["cm"].secondary is None and c["cm"].delta is None


def test_grid_cells_by_zone():
    z = lambda v: (("party_zone", v, False),)
    rows = [
        nr("support_share", "BJP", 50.0, dims=z("West")),
        nr("support_share", "BJP", 48.0, obs="o0", dims=z("West")),
        nr("delta_support", "BJP", 2.0, dims=z("West"), unit="pp"),
        nr("support_share", "BJP", 41.5, dims=SUB),
        nr("support_share", "SP", 20.0, dims=z("East")),
    ]
    g = build_grid(rows, row_dim="party_zone", round_ids=["o0", "o1"], anchor="o1",
                   compare="o0")
    assert set(g) == {("West", "BJP"), ("East", "SP")}
    assert g[("West", "BJP")] == Cell(50.0, 2.0, (48.0, 50.0), None, frozenset())
    assert g[("East", "SP")].trend == (None, 20.0)


def test_keep_party_without_support_rows_does_not_fall_back_to_bench():
    rows = [nr("support_share", "BJP", 41.5), nr("vote_share_bench", "SP", 29.0),
            nr("seats_ac", "SP", 100, unit="seats")]
    sp = board(rows)["SP"].vote
    assert sp.value is None and sp.trend == (None, None)
    assert "not_asked" in sp.flags and "vote_from_seat_view" not in sp.flags


def test_non_keep_seat_winner_bench_vote_is_last_resort_and_flagged():
    rows = [nr("support_share", "BJP", 41.5), nr("seats_ac", "JDL", 2, unit="seats"),
            nr("vote_share_bench", "JDL", 3.2)]
    jdl = board(rows)["JDL"]
    assert jdl.vote.value == 3.2
    assert {"vote_from_seat_view", "within_other"} <= jdl.vote.flags
    assert "within_other" in jdl.flags


def test_conflicting_duplicate_rows_raise():
    import pytest
    rows = [nr("support_share", "BJP", 41.5), nr("support_share", "BJP", 42.0)]
    with pytest.raises(ValueError, match="Conflicting"):
        board(rows)
    board([nr("support_share", "BJP", 41.5), nr("support_share", "BJP", 41.5)])


def test_seat_winner_only_in_unselected_round_gets_no_row():
    rows = [nr("support_share", "BJP", 41.5), nr("seats_ac", "JDL", 2, obs="o9", unit="seats")]
    assert "JDL" not in board(rows)


def test_seat_winner_in_non_anchor_selected_round_gets_row():
    rows = [nr("support_share", "BJP", 41.5), nr("seats_ac", "JDL", 2, obs="o0", unit="seats"),
            nr("vote_share_bench", "JDL", 3.2, obs="o0")]
    jdl = board(rows)["JDL"]
    assert jdl.seats_ac.trend == (2, None) and jdl.seats_ac.value is None
    assert "not_asked" in jdl.seats_ac.flags


def test_missing_delta_row_flags_no_delta():
    c = board([nr("support_share", "BJP", 41.5)])["BJP"].vote
    assert c.delta is None and "no_delta" in c.flags
    assert "no_delta" not in board([nr("support_share", "BJP", 41.5)], compare=None)["BJP"].vote.flags
