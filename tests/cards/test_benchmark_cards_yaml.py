from __future__ import annotations

from pathlib import Path

from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
from matbodh_dashboard.cards.config import load_cards
from tests.cards.test_benchmark_compile import _compile

CARDS = load_cards(Path(__file__).resolve().parents[2] / "config" / "cards" / "cards.yaml")


def test_both_benchmark_cards_load_and_share_one_engine_config():
    a, b = CARDS["benchmark.up_zone_nda"], CARDS["benchmark.up_zone_nda_flips"]
    assert (a.view.table, b.view.table) == ("comparison", "flips")
    assert a.benchmark == b.benchmark and a.benchmark.focal_party == "NDA"
    reference = BenchmarkReference(kind="compare")
    plan_a, plan_b = _compile(card=a, reference=reference), _compile(card=b, reference=reference)
    assert plan_a.unavailable == () and plan_a.jobs[0].config == plan_b.jobs[0].config
