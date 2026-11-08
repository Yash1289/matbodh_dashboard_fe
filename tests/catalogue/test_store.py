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
    assert r2.normal.fields == frozenset({"age", "gender", "religion"})
    assert r2.normal.scenarios == frozenset({"s1"})


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
