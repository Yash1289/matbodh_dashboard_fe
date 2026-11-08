import pytest

from matbodh_dashboard.catalogue.store import load_catalogue, clickhouse_query
from tests.fixtures.catalogue_rows import DATASET_ROWS, dataset_row, make_query


@pytest.fixture
def catalogue():
    return load_catalogue(make_query())


def test_rounds_pair_normal_and_extrapolated(catalogue):
    r1, r2 = catalogue.rounds("Uttar Pradesh", "ac")
    assert r1.identity.round == 1 and r2.identity.round == 2
    assert r2.normal.dataset_id == "2027 VS CAPI R2"
    assert r2.extrapolated.dataset_id == "2027 VS CAPI R2 (Extrapolated)"
    assert r1.extrapolated is None
    assert catalogue.states() == ("Uttar Pradesh",)
    assert catalogue.find("Uttar Pradesh", "2027 VS CAPI R2") is r2
    with pytest.raises(KeyError):
        catalogue.find("Uttar Pradesh", "nope")


def test_rounds_filtered_by_level(catalogue):
    assert len(catalogue.rounds("Uttar Pradesh", "ac")) == 2
    assert len(catalogue.rounds("Uttar Pradesh", "zone")) == 1
    assert len(catalogue.rounds("Uttar Pradesh")) == 3


def test_missing_extrapolated_falls_back(catalogue):
    r1 = catalogue.find("Uttar Pradesh", "2027 VS CAPI R1")
    assert r1.version("extrapolated") == (r1.normal, True)
    assert r1.version("matched") == (r1.normal, False)
    r2 = catalogue.find("Uttar Pradesh", "2027 VS CAPI R2")
    assert r2.version("extrapolated") == (r2.extrapolated, False)
    assert r2.version("matched") == (r2.normal, False)


def test_borrowed_seats_loaded(catalogue):
    r2 = catalogue.find("Uttar Pradesh", "2027 VS CAPI R2")
    assert len(r2.extrapolated.borrowed_seat_ids) == 23
    assert len(r2.extrapolated.seat_ids) == 403
    assert r2.normal.borrowed_seat_ids == frozenset()
    assert r2.normal.fields == frozenset({"age", "gender", "ac_num", "pc_num", "religion"})
    assert r2.normal.scenarios == frozenset({"s1", "vs_voting_intention"})


def test_revision_is_max_update_revision(catalogue):
    assert catalogue.revision == 9


def test_queries_are_read_only_final_active():
    q = make_query()
    load_catalogue(q)
    assert len(q.calls) == 2
    assert all("FINAL" in s and "is_active = 1" in s for s in q.calls)


def test_unparseable_names_are_skipped_not_dropped():
    rows = DATASET_ROWS + [
        dataset_row("Legacy Survey", cycle_id="Legacy"),
        dataset_row("Other thing", cycle_id="2027 VS"),
    ]
    cat = load_catalogue(make_query(dataset_rows=rows))
    assert [d for d, _ in cat.skipped] == ["Legacy Survey", "Other thing"]
    assert all(reason for _, reason in cat.skipped)
    assert len(cat.rounds("Uttar Pradesh")) == 3


def test_clickhouse_query_wraps_client():
    class Result:
        column_names = ["a", "b"]
        result_rows = [(1, 2)]

    class Client:
        def query(self, sql, parameters, settings):
            self.seen = (sql, parameters, settings)
            return Result()

    c = Client()
    assert clickhouse_query(c)("SELECT 1", {"x": 1}) == [{"a": 1, "b": 2}]
    assert c.seen[2] == {"readonly": 1, "max_execution_time": 60}


def _levels_plus(*dataset_ids):
    from tests.fixtures.catalogue_rows import LEVEL_ROWS, level_row

    return LEVEL_ROWS + [level_row(d, range(1, 5)) for d in dataset_ids]


def test_dataset_without_levels_is_skipped():
    rows = DATASET_ROWS + [dataset_row("2027 VS CAPI R3", round_number=3)]
    cat = load_catalogue(make_query(dataset_rows=rows))
    assert cat.skipped == (("2027 VS CAPI R3", "no active levels"),)
    assert len(cat.rounds("Uttar Pradesh")) == 3


def test_duplicate_variant_skipped_regardless_of_row_order():
    dup = dataset_row("2027 VS CAPI R1", round_number=1, revision=50)
    dup["dataset_id"] = "2027 VS CAPI R1 dup"
    dup["survey_name"] = "2027 VS CAPI R1"
    levels = _levels_plus(dup["dataset_id"])
    for order in (DATASET_ROWS + [dup], [dup] + DATASET_ROWS):
        cat = load_catalogue(make_query(dataset_rows=order, level_rows=levels))
        assert cat.skipped[0][0] == "2027 VS CAPI R1 dup"
        assert "duplicate normal" in cat.skipped[0][1]
        r1 = cat.find("Uttar Pradesh", "2027 VS CAPI R1")
        assert r1.normal.dataset_id == "2027 VS CAPI R1"
        assert cat.revision == 9  # skipped dataset's revision ignored


def test_unknown_variant_skipped():
    bad = dataset_row("2027 VS CAPI R7", variant="weird", round_number=7)
    cat = load_catalogue(
        make_query(dataset_rows=DATASET_ROWS + [bad], level_rows=_levels_plus(bad["dataset_id"]))
    )
    assert "unknown variant" in dict(cat.skipped)["2027 VS CAPI R7"]


def test_level_mismatch_skips_extrapolated_regardless_of_row_order():
    ext = dataset_row("2027 VS CAPI R1 (Extrapolated)", variant="extrapolated",
                      level="pc", round_number=1)
    levels = _levels_plus(ext["dataset_id"])
    for order in (DATASET_ROWS + [ext], [ext] + DATASET_ROWS):
        cat = load_catalogue(make_query(dataset_rows=order, level_rows=levels))
        assert "differs" in dict(cat.skipped)[ext["dataset_id"]]
        r1 = cat.find("Uttar Pradesh", "2027 VS CAPI R1")
        assert r1.level == "ac" and r1.extrapolated is None


def test_invalid_revision_and_level_skipped_and_excluded_from_revision():
    bad_rev = dataset_row("2027 VS CAPI R8", round_number=8, revision="x")
    bad_lvl = dataset_row("2027 VS CAPI R9", round_number=9, level="district",
                          revision=999)
    cat = load_catalogue(
        make_query(dataset_rows=DATASET_ROWS + [bad_rev, bad_lvl],
                   level_rows=_levels_plus("2027 VS CAPI R8", "2027 VS CAPI R9"))
    )
    skipped = dict(cat.skipped)
    assert "update_revision" in skipped["2027 VS CAPI R8"]
    assert "collection level" in skipped["2027 VS CAPI R9"]
    assert cat.revision == 9


def test_extrapolated_only_round():
    ext = dataset_row("2027 VS CAPI R5 (Extrapolated)", variant="extrapolated",
                      round_number=5)
    cat = load_catalogue(make_query(dataset_rows=[ext],
                                    level_rows=_levels_plus(ext["dataset_id"])))
    r5 = cat.find("Uttar Pradesh", "2027 VS CAPI R5")
    assert r5.version("extrapolated") == (r5.extrapolated, False)
    with pytest.raises(ValueError, match="no Normal version for 2027 VS CAPI R5"):
        r5.version("matched")
