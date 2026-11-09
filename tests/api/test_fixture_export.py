"""The frontend's JSON fixtures are generated from the real API; keep them current."""

from __future__ import annotations

import json
from pathlib import Path

from tests.api.fixture_export import FIXTURE_DIR, export

NAMES = {
    "states", "surveys", "templates_pulse", "plan_scoreboard",
    "plan_by_zone_state_level", "run_scoreboard_done", "run_scoreboard_partial",
    "run_scoreboard_within_other", "run_leaders_done", "run_change_appetite_done",
    "run_by_zone_done", "run_running",
}


def load(paths: list[Path]) -> dict:
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in paths}


def test_frontend_fixtures_current(tmp_path):
    for path in export(tmp_path):
        committed = FIXTURE_DIR / path.name
        assert committed.exists() and committed.read_bytes() == path.read_bytes(), (
            f"{path.name} is stale; run: python -m tests.api.fixture_export")


def test_fixture_set_covers_card_states(tmp_path):
    data = load(export(tmp_path))
    assert set(data) == NAMES
    partial = data["run_scoreboard_partial"]
    assert partial["state"] == "partial" and "seats_pc" in partial["errors"]
    assert data["run_running"]["state"] == "running" and data["run_running"]["result"] is None
    assert data["plan_by_zone_state_level"]["unavailable"]
    rows = data["run_scoreboard_within_other"]["result"]["scoreboard"]
    assert any("within_other" in row["flags"] for row in rows)
    assert '"not_asked"' in json.dumps(data["run_leaders_done"]["result"])
    for name in NAMES - {"run_scoreboard_partial", "run_running"}:
        if name.startswith("run_"):
            assert data[name]["state"] == "done", name
