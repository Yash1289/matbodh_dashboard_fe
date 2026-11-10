"""The manual smoke script's assembly path, wired to fakes (no database, no Redis)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from matbodh_dashboard.context import StateContext
from matbodh_dashboard.settings import Settings
from tests.runner.test_service import R1, R2, STATE, FakeRunner, catalogue

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("smoke_card", ROOT / "scripts/smoke_card.py")
smoke = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(smoke)

CARD = "opinion.leaders"


def _settings():
    return Settings(Path("unused.env"), "redis://unused", 3600, ROOT / "config")


def test_script_runs_a_card_end_to_end_with_fakes():
    service = smoke.build_service(_settings(), catalogue(), FakeRunner())
    ctx = StateContext(state=STATE, level="ac", rounds=[R1, R2], compare_round=R1)
    run_id, status, seconds = smoke.run_card(service, CARD, ctx)
    assert status.state == "done" and status.errors == {}
    lines = smoke.report(service, run_id, status, seconds)
    assert lines[0].startswith("state=done jobs=1/1")
    assert sum(line.startswith("  job part=grid") for line in lines) == 1
    assert "family=opinion mode=standalone" in lines[1]
    assert any(line.lstrip().startswith("cut g0:") and "cells=" in line for line in lines)
    assert not any(line.startswith("ERROR") for line in lines)


def test_report_lists_unavailable_reasons():
    service = smoke.build_service(_settings(), catalogue(), FakeRunner())
    ctx = StateContext(state=STATE, level="ac", rounds=[R1, R2], compare_round=R1)
    run_id, status, seconds = smoke.run_card(service, "distribution.support_by_caste", ctx)
    lines = smoke.report(service, run_id, status, seconds)
    assert any(line.startswith("unavailable:") for line in lines)


def test_main_end_to_end_with_stubbed_database_pieces(monkeypatch, capsys):
    import matbodh_dashboard.catalogue.store as store
    import matbodh_dashboard.runner.engine as engine
    import matbodh_views.connections as connections

    closed = []

    class FakeClient:
        def close(self):
            closed.append(True)

    monkeypatch.setattr(smoke, "load_settings", _settings)
    monkeypatch.setattr(connections, "create_clickhouse_client", lambda env_file: FakeClient())
    monkeypatch.setattr(store, "clickhouse_query", lambda client: None)
    monkeypatch.setattr(store, "load_catalogue", lambda query: catalogue())
    monkeypatch.setattr(engine, "build_runtime", lambda env_file: FakeRunner())
    monkeypatch.setattr(engine, "EngineRunner", lambda runtime: runtime)

    code = smoke.main(["--card", CARD, "--state", STATE, "--rounds", R1, R2])

    out = capsys.readouterr().out
    assert code == 0 and closed == [True]
    assert "family=opinion" in out


def test_main_rejects_invalid_rounds_before_running(monkeypatch, capsys):
    import matbodh_dashboard.catalogue.store as store
    import matbodh_views.connections as connections

    class FakeClient:
        def close(self):
            pass

    monkeypatch.setattr(smoke, "load_settings", _settings)
    monkeypatch.setattr(connections, "create_clickhouse_client", lambda env_file: FakeClient())
    monkeypatch.setattr(store, "clickhouse_query", lambda client: None)
    monkeypatch.setattr(store, "load_catalogue", lambda query: catalogue())
    code = smoke.main(["--card", CARD, "--state", STATE, "--rounds", R1, R1])
    assert code == 2 and "INVALID: duplicate rounds" in capsys.readouterr().out


def test_main_rejects_an_unknown_card(monkeypatch, capsys):
    import matbodh_dashboard.catalogue.store as store
    import matbodh_views.connections as connections

    class FakeClient:
        def close(self):
            pass

    monkeypatch.setattr(smoke, "load_settings", _settings)
    monkeypatch.setattr(connections, "create_clickhouse_client", lambda env_file: FakeClient())
    monkeypatch.setattr(store, "clickhouse_query", lambda client: None)
    monkeypatch.setattr(store, "load_catalogue", lambda query: catalogue())
    code = smoke.main(["--card", "nope.nothing", "--state", STATE, "--rounds", R1, R2])
    assert code == 2 and "INVALID: unknown card" in capsys.readouterr().out


def test_smoke_card_parses_card_id():
    args = smoke.parse_args(["--card", CARD, "--state", STATE, "--rounds", R1, R2])
    assert args.card == CARD and args.rounds == [R1, R2]


def test_single_round_has_no_compare_round():
    assert smoke.build_context(STATE, [R2]).compare_round is None
    ctx = smoke.build_context(STATE, [R1, R2])
    assert ctx.compare_round == R1 and ctx.rounds == [R1, R2]
