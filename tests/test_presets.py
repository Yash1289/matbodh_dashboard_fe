from pathlib import Path

import pytest
from pydantic import ValidationError

from matbodh_dashboard.presets import load_preset

CONFIG = Path(__file__).resolve().parent.parent / "config"
PRESET_PATH = CONFIG / "presets" / "uttar-pradesh.standard-v1.yaml"


def test_uttar_pradesh_preset_loads_provisional_values():
    p = load_preset(PRESET_PATH)
    assert p.id == "uttar-pradesh.standard-v1"
    assert p.version == 1
    assert (p.weights.mode, p.weights.invalid, p.weights.zero) == (
        "mj_cap", "exclude", "include")
    assert p.answers_excluded == [""]
    assert p.strip_whitespace is True
    assert p.keep == ["NDA", "SP+", "BSP"]
    assert p.other_label == "Other"
    assert p.passthrough is True
    assert p.opinion_weights.source == "base"
    assert p.opinion_weights.scenario is None
    assert p.opinion_weights.mode is None
    assert p.caste_threshold_pct == 0.5
    assert p.gender.field == "gender"
    assert p.gender.female == ["Female"]
    assert p.gender.male == ["Male"]
    assert p.competition_excluded == ["NOTA"]
    assert p.alliance_reporting_type == "MatBodh"


def test_preset_rejects_unknown_key(tmp_path):
    bad = tmp_path / "bad.yaml"
    bad.write_text(PRESET_PATH.read_text(encoding="utf-8") + "surprise: 1\n", encoding="utf-8")
    with pytest.raises(ValidationError):
        load_preset(bad)
