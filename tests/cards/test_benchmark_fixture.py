from __future__ import annotations

import json
from collections import defaultdict

import pytest

from tests.cards.benchmark_helpers import load_benchmark_sample


def test_fixture_shape_and_known_values() -> None:
    d = load_benchmark_sample()
    assert len(d["summaries"]) == 128
    assert len(d["comparisons"]) == 64
    assert len(d["margin_buckets"]) == 192
    assert len(d["flips"]) == 64
    g0 = {r["party_id"]: r for r in d["comparisons"] if r["grouping_set_id"] == "g0"}
    assert g0["NDA"]["target_seat_count"] == 154
    assert g0["NDA"]["reference_seat_count"] == 273
    assert g0["NDA"]["seat_count_delta"] == -119
    assert g0["Other"]["reference_seat_count"] == 4
    assert g0["Other"]["vote_share_delta_pp"] == pytest.approx(-4.71, abs=0.01)
    totals: dict[tuple, float] = defaultdict(float)
    for r in d["summaries"]:
        totals[(r["endpoint"], r["grouping_set_id"], json.dumps(r["dimensions"], sort_keys=True))] += r["vote_share"]
    assert all(v == pytest.approx(100.0, abs=1e-6) for v in totals.values())
