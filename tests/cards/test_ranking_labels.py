from types import SimpleNamespace

from matbodh_dashboard.cards.ranking.labels import MasterSeatLabels
from matbodh_dashboard.cards.ranking.translate import translate_ranked
from tests.cards.ranking_helpers import load_rank_sample, ranked_ctx, seat_card

CTX = ranked_ctx("ranking.test", ["o2"], "o2")


class FakeProvider:
    def __init__(self, names=None, error=None):
        self.calls = []
        self.names, self.error = names, error

    def labels(self, state, level, seat_ids):
        self.calls.append((state, level, tuple(seat_ids)))
        if self.error:
            raise self.error
        return {i: {"name": f"Seat {i}", "zone": "Z"} for i in seat_ids
                if self.names is None or i in self.names}


def _sample(rows=None):
    sample = load_rank_sample("result_rank.json")
    if rows is not None:
        sample["rows"] = sample["rows"][:rows]
    return sample


def test_engine_row_name_wins_over_provider():
    sample = _sample(3)
    sample["rows"][0]["seat_name"] = "Lucknow West"
    provider = FakeProvider()
    payload = translate_ranked(seat_card(), {"o2": sample}, CTX, labels=provider)
    by_id = {e.labels["seat_id"]: e.labels for e in payload.entities}
    first = sample["rows"][0]["seat_id"]
    assert by_id[first]["name"] == "Lucknow West"
    other = sample["rows"][1]["seat_id"]
    assert by_id[other]["name"] == f"Seat {other}"


def test_provider_fills_names_and_zone_with_one_call():
    sample = _sample(3)
    provider = FakeProvider()
    payload = translate_ranked(seat_card(), {"o2": sample}, CTX, labels=provider)
    assert len(provider.calls) == 1
    state, level, ids = provider.calls[0]
    assert (state, level) == ("Uttar Pradesh", "ac")
    assert sorted(ids) == sorted(int(r["seat_id"]) for r in sample["rows"])
    assert all(e.labels["zone"] == "Z" and e.labels["name"] for e in payload.entities)


def test_provider_failure_never_fails_the_card():
    payload = translate_ranked(seat_card(), {"o2": _sample(3)}, CTX,
                               labels=FakeProvider(error=RuntimeError("mysql down")))
    assert all(set(e.labels) == {"seat_id"} for e in payload.entities)


def test_a_seat_missing_from_the_master_keeps_only_its_number():
    sample = _sample(2)
    known = int(sample["rows"][0]["seat_id"])
    payload = translate_ranked(seat_card(), {"o2": sample}, CTX,
                               labels=FakeProvider(names={known}))
    by_id = {e.labels["seat_id"]: e.labels for e in payload.entities}
    assert "name" in by_id[str(known)]
    assert set(by_id[sample["rows"][1]["seat_id"]]) == {"seat_id"}


def _snapshot(records, calls):
    def load(state, level, attrs):
        calls.append((state, level, attrs))
        return SimpleNamespace(records=tuple(records))
    return load


def test_master_labels_read_ac_and_pc_names():
    calls = []
    ac = MasterSeatLabels(_snapshot([{"ac_num": 1, "ac_name": "A", "zone": "East"}], calls),
                          lambda: 1)
    assert ac.labels("UP", "ac", [1, 2]) == {1: {"name": "A", "zone": "East"}}
    assert calls == [("UP", "ac", ("ac_name", "zone"))]
    pc = MasterSeatLabels(_snapshot([{"pc_num": 7, "pc_name": "P", "zone": "West"}], []),
                          lambda: 1)
    assert pc.labels("UP", "pc", [7]) == {7: {"name": "P", "zone": "West"}}


def test_master_labels_fall_back_to_names_when_zone_is_missing():
    def load(state, level, attrs):
        if "zone" in attrs:
            raise ValueError("Missing seat attribute zone")
        return SimpleNamespace(records=({"ac_num": 1, "ac_name": "A"},))
    assert MasterSeatLabels(load, lambda: 1).labels("UP", "ac", [1]) == {1: {"name": "A"}}


def test_master_labels_cache_follows_the_revision():
    calls, revision = [], [1]
    labels = MasterSeatLabels(_snapshot([{"ac_num": 1, "ac_name": "A", "zone": "Z"}], calls),
                              lambda: revision[0])
    labels.labels("UP", "ac", [1])
    labels.labels("UP", "ac", [1])
    assert len(calls) == 1
    revision[0] = 2
    labels.labels("UP", "ac", [1])
    assert len(calls) == 2
