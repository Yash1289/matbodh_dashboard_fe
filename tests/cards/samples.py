"""Real engine results (aggregates only) copied from MatBodh-Dash/sample-output."""
from __future__ import annotations

import json
from pathlib import Path

SAMPLES_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "engine_samples"

FAMILY_SAMPLES: dict[str, tuple[str, ...]] = {
    "distribution": (
        "result.json",
        "result_geo.json",
        "result_overall.json",
        "result_ac_1_across.json",
        "result_caste_complex.json",
        "result_ac_1_caste_all_final_ultimate_final.json",
    ),
    "opinion": (
        "result_opinion.json",
        "result_opinion_comp.json",
        "result_opinion_comp_ac_1.json",
        "result_opinion_comp_ultimate.json",
        "result_ac_1_across.json",
    ),
    "gender_differential": ("result_gd.json",),
}


def load_sample(name: str) -> dict:
    with (SAMPLES_DIR / name).open(encoding="utf-8") as handle:
        return json.load(handle)
