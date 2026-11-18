import json
from pathlib import Path

import pytest

from matbodh_dashboard.cards.cohort.translate import translate_selection

SAMPLE = Path(__file__).resolve().parents[1] / "fixtures" / "engine_samples" / "selection_rows_rank.json"


def test_seat_ids_come_only_from_the_engine_selection_rows():
    sample = json.loads(SAMPLE.read_text())
    preview = translate_selection(sample, {"ranking": {"seat_level": "ac"}})
    assert preview.seat_level == "ac" and preview.count == 75 == len(preview.seat_ids)
    assert preview.seat_ids == sorted({int(r["seat_id"]) for r in sample["selection_rows"]})


def test_benchmark_level_and_pc_ids():
    preview = translate_selection({"selection_rows": [{"seat_id": "7"}, {"seat_id": "2"}]},
                                  {"benchmark": {"seat_level": "pc"}})
    assert (preview.seat_level, preview.seat_ids, preview.count) == ("pc", [2, 7], 2)


def test_no_matching_seats_is_an_empty_preview_not_all_seats():
    preview = translate_selection({"selection_rows": []}, {"ranking": {"seat_level": "ac"}})
    assert preview.count == 0 and preview.seat_ids == []


def test_a_bad_seat_id_from_the_engine_is_an_error_not_a_guess():
    with pytest.raises(ValueError):
        translate_selection({"selection_rows": [{"seat_id": "x"}]}, {"ranking": {"seat_level": "ac"}})
