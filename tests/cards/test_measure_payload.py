"""measure() reports how big a real engine result becomes as a card payload."""

import importlib.util
from pathlib import Path

import pytest

from tests.cards.samples import SAMPLES_DIR

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("measure_payload", ROOT / "scripts/measure_payload.py")
measure_payload = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(measure_payload)

SAMPLES = [
    ("distribution", "result_ac_1_caste_all_final_ultimate_final.json"),
    ("opinion", "result_opinion.json"),
    ("gender_differential", "result_gd.json"),
]


@pytest.mark.parametrize(("family", "sample"), SAMPLES)
def test_measure_reports_positive_sizes_and_gzip_is_smaller(family, sample):
    size = measure_payload.measure(SAMPLES_DIR / sample, family)
    assert set(size) == {"rows", "json_bytes", "gzip_bytes"}
    assert size["rows"] > 0
    assert size["json_bytes"] > 0
    assert 0 < size["gzip_bytes"] < size["json_bytes"]


def test_measure_counts_every_row_of_every_cut():
    size = measure_payload.measure(SAMPLES_DIR / "result_ac_1_caste_all_final_ultimate_final.json", "distribution")
    one_cut = measure_payload.measure(SAMPLES_DIR / "result_overall.json", "distribution")
    assert size["rows"] > one_cut["rows"]
