"""The fixture exporter turns real engine samples into payloads the frontend tests use."""

import importlib.util
import json
from pathlib import Path

import pytest

from matbodh_dashboard.cards.payload import GridPayload

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location(
    "export_card_fixtures", ROOT / "scripts/export_card_fixtures.py")
exporter = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(exporter)

EXPECTED = {
    "distribution_standalone.json", "distribution_compare.json", "distribution_trend.json",
    "opinion_standalone.json", "opinion_compare.json", "opinion_trend.json",
    "gender_differential_standalone.json",
}


@pytest.fixture(scope="module")
def exported(tmp_path_factory):
    out = tmp_path_factory.mktemp("fixtures")
    paths = exporter.export_fixtures(out)
    return {p.name: json.loads(p.read_text(encoding="utf-8")) for p in paths}


def test_export_writes_one_fixture_per_mode_and_family(exported):
    assert set(exported) == EXPECTED


def test_every_fixture_is_a_valid_grid_payload(exported):
    for name, payload in exported.items():
        GridPayload.model_validate(payload)
        assert payload["cuts"] and payload["columns"], name


def test_modes_match_the_file_names(exported):
    for name, payload in exported.items():
        assert name.endswith(f"_{payload['mode']}.json"), name


def test_compare_fixtures_carry_engine_deltas(exported):
    for name in ("distribution_compare.json", "opinion_compare.json"):
        payload = exported[name]
        assert any(cut["deltas"] for cut in payload["cuts"]), name
        assert payload["meta"]["capabilities"]["modes"] == ["standalone", "compare", "trend"]


def test_trend_fixtures_have_values_for_two_rounds_and_no_deltas(exported):
    for name in ("distribution_trend.json", "opinion_trend.json"):
        payload = exported[name]
        assert all(cut["deltas"] == [] for cut in payload["cuts"]), name
        rounds = {c["round"] for cut in payload["cuts"] for c in cut["cells"]}
        assert len(rounds) == 2, name


def test_round_labels_are_series_qualified(exported):
    for payload in exported.values():
        for item in payload["rounds"]["items"]:
            assert item["base_name"].startswith("2027 VS CAPI R")
