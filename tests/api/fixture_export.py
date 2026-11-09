"""Export real API responses (fake engine) as the frontend's JSON fixtures.

Run: python -m tests.api.fixture_export
"""

from __future__ import annotations

import json
from pathlib import Path

import fakeredis
from fastapi.testclient import TestClient

from matbodh_dashboard.api.app import create_app
from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.registry import load_rules
from matbodh_dashboard.runner.cache import ResultCache
from matbodh_dashboard.runner.queue import InlineQueue
from matbodh_dashboard.runner.service import CardRunService
from tests.fixtures.catalogue_rows import (
    DATASET_ROWS, LEVEL_ROWS, dataset_row, level_row, make_query,
)
from tests.runner.test_service import (
    PRESET, RULES_YAML, TEMPLATES, FakeRunner, ManualQueue,
    part_of,
)

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "web/src/test/fixtures"
STATE = "Uttar Pradesh"
R1, R2 = "2027 VS CAPI R1", "2027 VS CAPI R2"
STATE_R1 = "2027 VS CAPI SL R1"  # the shared catalogue has no state-level round
SCOREBOARD, LEADERS = "pulse.party_scoreboard", "pulse.leaders"
CHANGE_APPETITE, BY_ZONE = "pulse.change_appetite", "pulse.by_zone"


class JdlWinsRunner(FakeRunner):
    """JDL, a contender outside the keep list, wins 2 AC seats in o1 and none in o2."""

    def run(self, config: dict) -> dict:
        result = super().run(config)
        if part_of(config) == "seats_ac":
            for summary in result["summaries"]:
                if summary["party_id"] == "JDL" and summary["endpoint"] == "o1":
                    summary["seat_count"] = 2
            for comparison in result["comparisons"]:
                if comparison["party_id"] == "JDL":
                    comparison["seat_count_delta"] = -2
        return result


def context(**overrides) -> dict:
    ctx = {"state": STATE, "level": "ac", "rounds": [R1, R2], "compare_round": R1}
    return {**ctx, **overrides}


def build_service(tmp: Path, runner: FakeRunner, manual: bool = False, query=None):
    (tmp / "global.yaml").write_text(RULES_YAML, encoding="utf-8")
    cache = ResultCache(fakeredis.FakeStrictRedis(), ttl_seconds=3600)
    queue = ManualQueue(runner, cache) if manual else InlineQueue(
        runner, cache, sleep=lambda s: None)
    return CardRunService(load_catalogue(query or make_query()), PRESET, TEMPLATES,
                          load_rules(tmp), cache, queue, "0.8.0")


def run_card(client: TestClient, card: str, ctx: dict) -> dict:
    started = client.post("/cards/run", json={"card_id": card, "context": ctx})
    assert started.status_code == 200, started.text
    return client.get(f"/runs/{started.json()['run_id']}").json()


def export(out_dir: Path) -> list[Path]:
    import tempfile
    out_dir.mkdir(parents=True, exist_ok=True)
    ctx = context()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for sub in ("main", "partial", "other", "manual", "state"):
            (tmp / sub).mkdir()
        state_query = make_query(
            dataset_rows=[*DATASET_ROWS, dataset_row(STATE_R1, level="state")],
            level_rows=[*LEVEL_ROWS, level_row(STATE_R1, range(1, 2))])
        state = TestClient(create_app(build_service(tmp / "state", FakeRunner(), query=state_query)))
        main = TestClient(create_app(build_service(tmp / "main", FakeRunner())))
        # A seat winner outside the keep list: the backend assembles a within_other row.
        other = TestClient(create_app(build_service(tmp / "other", JdlWinsRunner())))
        partial = TestClient(create_app(build_service(
            tmp / "partial", FakeRunner(failures={"seats_pc": [ValueError("pc boom")]}))))
        manual = TestClient(create_app(build_service(tmp / "manual", FakeRunner(), manual=True)))

        zone_ctx = context(level="state", rounds=[STATE_R1], compare_round=None)
        responses = {
            "states": main.get("/catalogue/states").json(),
            "surveys": main.get(f"/catalogue/{STATE}/surveys").json(),
            "templates_pulse": main.get("/templates", params={"section": "pulse"}).json(),
            "plan_scoreboard": main.post(
                "/cards/plan", json={"card_id": SCOREBOARD, "context": ctx}).json(),
            "plan_by_zone_state_level": state.post(
                "/cards/plan", json={"card_id": BY_ZONE, "context": zone_ctx}).json(),
            "run_scoreboard_done": run_card(main, SCOREBOARD, ctx),
            "run_scoreboard_partial": run_card(partial, SCOREBOARD, ctx),
            "run_scoreboard_within_other": run_card(other, SCOREBOARD, ctx),
            "run_leaders_done": run_card(main, LEADERS, ctx),
            "run_change_appetite_done": run_card(main, CHANGE_APPETITE, ctx),
            "run_by_zone_done": run_card(main, BY_ZONE, ctx),
            "run_running": run_card(manual, SCOREBOARD, ctx),
        }
    paths = []
    for name, data in responses.items():
        path = out_dir / f"{name}.json"
        path.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
                        encoding="utf-8", newline="\n")
        paths.append(path)
    return paths


def main() -> None:
    for path in export(FIXTURE_DIR):
        print(path)


if __name__ == "__main__":
    main()
