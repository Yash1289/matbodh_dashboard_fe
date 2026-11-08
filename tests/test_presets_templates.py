from pathlib import Path

import pytest
from pydantic import ValidationError

from matbodh_dashboard.presets import load_preset
from matbodh_dashboard.templates import load_templates

CONFIG = Path(__file__).resolve().parent.parent / "config"
PRESET_PATH = CONFIG / "presets" / "uttar-pradesh.standard-v1.yaml"
PULSE_PATH = CONFIG / "templates" / "pulse.yaml"


def test_preset_loads_provisional_values():
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


def test_pulse_templates_present():
    t = load_templates(PULSE_PATH)
    assert set(t) == {
        "pulse.party_scoreboard", "pulse.leaders",
        "pulse.change_appetite", "pulse.by_zone"}
    sb = t["pulse.party_scoreboard"]
    assert sb.operation == "scoreboard"
    assert sb.questions == ["vs_voting_intention"]
    assert sb.measures == ["support_share", "seats_ac", "seats_pc", "gender_gap"]
    assert sb.cell == ["value", "delta", "trend"]
    assert sb.requires.min_level == "state"
    assert t["pulse.leaders"].operation == "opinion"
    assert t["pulse.leaders"].measures == ["net_score"]
    assert t["pulse.change_appetite"].questions == ["state_govt_change"]


def test_by_zone_requires_ac_level():
    t = load_templates(PULSE_PATH)["pulse.by_zone"]
    assert t.requires.min_level == "ac"
    assert t.slices == ["party_zone"]
    assert t.operation == "distribution"


def test_card_cell_lists_are_pinned():
    t = load_templates(PULSE_PATH)
    assert t["pulse.by_zone"].cell == ["value", "delta", "trend"]
    assert t["pulse.by_zone"].requires.focus_party is False
    assert t["pulse.party_scoreboard"].cell == ["value", "delta", "trend"]
