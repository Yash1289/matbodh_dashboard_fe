"""The manual smoke script's assembly path, wired to fakes (no database, no Redis)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from matbodh_dashboard.context import StateContext
from matbodh_dashboard.settings import Settings
from tests.runner.test_service import R1, R2, STATE, FakeRunner, catalogue

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("smoke_state_pulse", ROOT / "scripts/smoke_state_pulse.py")
smoke = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(smoke)


def test_script_runs_scoreboard_end_to_end_with_fakes():
    settings = Settings(Path("unused.env"), "redis://unused", 3600, ROOT / "config")
    service = smoke.build_service(settings, catalogue(), FakeRunner())
    ctx = StateContext(state=STATE, level="ac", rounds=[R1, R2], compare_round=R1)
    run_id, status, seconds = smoke.run_card(service, ctx)
    assert status.state == "done" and status.errors == {}
    lines = smoke.report(service, run_id, status, seconds)
    assert lines[0].startswith("state=done jobs=4/4")
    assert sum(line.startswith("  job part=") for line in lines) == 4
    nda = next(line for line in lines if line.lstrip().startswith("NDA"))
    assert "154 (-88)" in nda and "26 (-22)" in nda  # AC and PC seats, engine deltas
    assert not any(line.startswith("ERROR") for line in lines)


def test_main_end_to_end_with_stubbed_database_pieces(monkeypatch, capsys):
    import matbodh_dashboard.catalogue.store as store
    import matbodh_dashboard.runner.engine as engine
    import matbodh_views.connections as connections

    closed = []

    class FakeClient:
        def close(self):
            closed.append(True)

    monkeypatch.setattr(smoke, "load_settings",
                        lambda: Settings(Path("unused.env"), "redis://unused", 3600, ROOT / "config"))
    monkeypatch.setattr(connections, "create_clickhouse_client", lambda env_file: FakeClient())
    monkeypatch.setattr(store, "clickhouse_query", lambda client: None)
    monkeypatch.setattr(store, "load_catalogue", lambda query: catalogue())
    monkeypatch.setattr(engine, "build_runtime", lambda env_file: FakeRunner())
    monkeypatch.setattr(engine, "EngineRunner", lambda runtime: runtime)

    code = smoke.main(["--state", STATE, "--rounds", R1, R2])

    out = capsys.readouterr().out
    assert code == 0 and closed == [True]
    nda = next(line for line in out.splitlines() if line.lstrip().startswith("NDA"))
    assert "154 (-88)" in nda and "26 (-22)" in nda


def test_main_rejects_invalid_rounds_before_running(monkeypatch, capsys):
    import matbodh_dashboard.catalogue.store as store
    import matbodh_views.connections as connections

    class FakeClient:
        def close(self):
            pass

    monkeypatch.setattr(smoke, "load_settings",
                        lambda: Settings(Path("unused.env"), "redis://unused", 3600, ROOT / "config"))
    monkeypatch.setattr(connections, "create_clickhouse_client", lambda env_file: FakeClient())
    monkeypatch.setattr(store, "clickhouse_query", lambda client: None)
    monkeypatch.setattr(store, "load_catalogue", lambda query: catalogue())
    code = smoke.main(["--state", STATE, "--rounds", R1, R1])
    assert code == 2 and "INVALID: duplicate rounds" in capsys.readouterr().out


def test_single_round_has_no_compare_round():
    assert smoke.build_context(STATE, [R2]).compare_round is None
    ctx = smoke.build_context(STATE, [R1, R2])
    assert ctx.compare_round == R1 and ctx.rounds == [R1, R2]
