"""Shared test data for benchmark cards: the live UP result (survey R2 vs 2022 VS, Other rows, 2026-11-12)."""
from __future__ import annotations

from tests.cards.samples import load_sample

# The engine endpoint ids the fixture was produced with (the example config's ids).
FIXTURE_ENDPOINT_IDS = {"target": "survey", "reference": "historical"}
FIXTURE_MAJORS = ("BSP", "NDA", "SP+")


def load_benchmark_sample() -> dict:
    return load_sample("result_benchmark_survey_vs_2022_other.json")
