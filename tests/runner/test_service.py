"""Card run service: cache, dedup, dependency order, retries and assembly.

No real database or Redis: fakeredis, InlineQueue / a manual queue and a fake
runner returning synthetic engine results. Every delta in the fixtures differs
from the difference of the displayed values, so a service that computed
numbers instead of copying them would fail.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import fakeredis
import pytest

from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import load_preset
from matbodh_dashboard.registry import load_rules
from matbodh_dashboard.runner.cache import ResultCache
from matbodh_dashboard.runner.engine import EngineError
from matbodh_dashboard.runner.queue import InlineQueue, RQQueue
from matbodh_dashboard.runner.service import CardRunService
from matbodh_dashboard.templates import load_templates
from tests.fixtures.catalogue_rows import make_query

ROOT = Path(__file__).resolve().parents[2]
PRESET = load_preset(ROOT / "config/presets/uttar-pradesh.standard-v1.yaml")
TEMPLATES = load_templates(ROOT / "config/templates/pulse.yaml")
STATE = "Uttar Pradesh"
R1, R2 = "2027 VS CAPI R1", "2027 VS CAPI R2"
SCOREBOARD = "pulse.party_scoreboard"
VOTE_SCENARIO = "vs_voting_intention"

RULES_YAML = """\
rules:
  - field: party
    order: [NDA, SP+, BSP, Other, Undecided, NOTA]
    pin_last: [Other, Undecided, NOTA]
    labels: {NDA: "NDA (BJP+)"}
    colours: {NDA: "#FF9933", SP+: "#E41A1C"}
    hidden: [NOTA]
"""

# Vote shares per round; NOTA present so contenders exclusion is exercised.
SHARES = {
    "o1": {"NDA": 40.0, "SP+": 30.0, "BSP": 12.0, "Other": 8.0, "NOTA": 1.0},
    "o2": {"NDA": 38.0, "SP+": 34.0, "BSP": 11.0, "Other": 9.0, "NOTA": 1.0},
}
# Engine deltas deliberately differ from o2 - o1 (-2.0, 4.0).
VOTE_DELTAS = {"NDA": -1.5, "SP+": 3.5}
SEATS = {
    "ac": {"o1": {"NDA": 243, "SP+": 158}, "o2": {"NDA": 154, "SP+": 249}},
    "pc": {"o1": {"NDA": 49, "SP+": 31}, "o2": {"NDA": 26, "SP+": 54}},
}
# Paired benchmark deltas deliberately differ from the per-round gaps.
SEAT_DELTAS = {"ac": {"NDA": -88, "SP+": 90}, "pc": {"NDA": -22, "SP+": 22}}
BENCH_COVERAGE = "common_positive_eligible_seats_full_constituents"


def part_of(config: dict) -> str:
    if "benchmark" in config:
        return f"seats_{config['benchmark']['seat_level']}"
    scenarios = config["request"]["scenarios"]
    if config["request"]["grouping_sets"] != [[]]:
        return "zone"
    return "vote" if scenarios == [VOTE_SCENARIO] else "opinion"


def vote_result(config: dict) -> dict:
    obs = [o["id"] for o in config["request"]["observations"]]
    rows = [
        {"observation_id": o, "scenario_id": VOTE_SCENARIO, "party_id": p,
         "support_share": v, "weighted_denominator": 1000.0, "grouping_set_id": "g0",
         "dimensions": {}}
        for o in obs for p, v in SHARES[o].items()
    ]
    comparisons = [
        {"comparison_id": f"c-{p}", "party_id": p, "measure": "support_share",
         "percentage_point_difference": d, "target": ["o2", VOTE_SCENARIO],
         "reference": ["o1", VOTE_SCENARIO], "coverage_status": "aligned",
         "dimensions": {}}
        for p, d in VOTE_DELTAS.items()
    ] if config["request"]["comparisons"] else []
    return {
        "rows": rows, "comparisons": comparisons, "scores": [], "populations": [],
        "gender_differentials": [],
        "context_status": {f"{o}:{VOTE_SCENARIO}": "available" for o in obs},
        "contract": {"coverage": {"mode": "independent"}},
    }


def bench_result(config: dict) -> dict:
    b = config["benchmark"]
    level = b["seat_level"]
    target = b["target"]["id"]
    endpoints = [target] + ([b["reference"]["id"]] if b["reference"] else [])
    summaries = [
        {"endpoint": e, "party_id": p, "seat_count": n, "vote_share": SHARES[e][p],
         "eligible_seat_count": 403, "support_base": 9000.0, "grouping_set_id": "g0",
         "dimensions": {}}
        for e in endpoints for p, n in SEATS[level][e].items()
    ]
    comparisons = [
        {"party_id": p, "seat_count_delta": d, "eligible_seat_count": 380,
         "grouping_set_id": "g0", "dimensions": {}}
        for p, d in SEAT_DELTAS[level].items()
    ] if b["reference"] else []
    return {
        "seat_results": [], "margin_buckets": [], "flips": [], "coverage": [],
        "summaries": summaries, "comparisons": comparisons,
        "contract": {"id": b["id"], "seat_level": level, "target": target,
                     "coverage": BENCH_COVERAGE},
    }


def opinion_result(config: dict) -> dict:
    obs = [o["id"] for o in config["request"]["observations"]]
    net = {"pm_satisfaction": {"o1": 20.0, "o2": 25.0},
           "cm_satisfaction": {"o1": 10.0, "o2": 5.0}}
    scores = [
        {"observation_id": o, "scenario_id": sc, "grouping_set_id": "g0",
         "positive_share": 50.0, "negative_share": 50.0 - v[o], "net_score": v[o],
         "weighted_denominator": 900.0, "coverage_status": "available", "dimensions": {}}
        for sc, v in net.items() for o in obs
    ]
    comparisons = [
        {"comparison_id": f"n-{sc}", "measure": "net_score",
         "percentage_point_difference": d, "target": ["o2", sc],
         "reference": ["o1", sc], "dimensions": {}}
        for sc, d in (("pm_satisfaction", 4.0), ("cm_satisfaction", -6.0))
    ]
    return {"rows": [], "comparisons": comparisons, "scores": scores, "populations": [],
            "gender_differentials": [], "context_status": {}, "contract": {}}


def zone_result(config: dict) -> dict:
    obs = [o["id"] for o in config["request"]["observations"]]
    shares = {"Bundelkhand": {"NDA": 45.0, "SP+": 30.0}, "Rohilkhand": {"NDA": 35.0, "SP+": 40.0}}
    rows = [
        {"observation_id": o, "scenario_id": VOTE_SCENARIO, "party_id": p,
         "support_share": v, "weighted_denominator": 300.0, "grouping_set_id": "g1",
         "dimensions": {"party_zone": {"value": z, "is_subtotal": False}}}
        for o in obs for z, ps in shares.items() for p, v in ps.items()
    ]
    return {"rows": rows, "comparisons": [], "scores": [], "populations": [],
            "gender_differentials": [], "context_status": {}, "contract": {}}


class FakeRunner:
    """Returns synthetic results by job part; pops scripted failures first."""

    def __init__(self, failures: dict[str, list[BaseException]] | None = None):
        self.failures = {k: list(v) for k, v in (failures or {}).items()}
        self.calls: list[dict] = []

    def parts(self) -> list[str]:
        return [part_of(c) for c in self.calls]

    def run(self, config: dict) -> dict:
        self.calls.append(config)
        part = part_of(config)
        pending = self.failures.get(part)
        if pending:
            raise pending.pop(0)
        if part.startswith("seats_"):
            return bench_result(config)
        return {"vote": vote_result, "opinion": opinion_result, "zone": zone_result}[part](config)


class ManualQueue:
    """Asynchronous stand-in: jobs run only when drained."""

    def __init__(self, runner: FakeRunner, cache: ResultCache):
        self.runner, self.cache = runner, cache
        self.pending: dict[str, dict] = {}
        self.submitted: list[str] = []

    def submit(self, fp: str, config: dict) -> None:
        if fp in self.pending or self.cache.get(fp) is not None:
            return
        self.submitted.append(fp)
        self.pending[fp] = config

    def state(self, fp: str) -> str:
        if self.cache.get(fp) is not None:
            return "done"
        if self.cache.error(fp) is not None:
            return "failed"
        return "queued"

    def drain(self) -> None:
        for fp, config in list(self.pending.items()):
            self.cache.put(fp, self.runner.run(config))
            del self.pending[fp]


def catalogue():
    return load_catalogue(make_query())


def ctx(**kw) -> StateContext:
    args = dict(state=STATE, level="ac", rounds=[R1, R2], compare_round=R1)
    args.update(kw)
    return StateContext(**args)


@pytest.fixture
def rules(tmp_path):
    (tmp_path / "global.yaml").write_text(RULES_YAML, encoding="utf-8")
    return load_rules(tmp_path)


@pytest.fixture
def cache():
    return ResultCache(fakeredis.FakeStrictRedis(), ttl_seconds=3600)


def make_service(rules, cache, runner=None, queue=None, templates=TEMPLATES, sleeps=None):
    runner = runner or FakeRunner()
    if queue is None:
        recorded = sleeps if sleeps is not None else []
        queue = InlineQueue(runner, cache, sleep=recorded.append)
    service = CardRunService(catalogue(), PRESET, templates, rules, cache, queue, "0.8.0")
    return service, runner


def board(status) -> dict:
    return {row["series"]: row for row in status.result["scoreboard"]}


def test_cache_hit_skips_runner(rules, cache):
    service, runner = make_service(rules, cache)
    first = service.status(service.start(SCOREBOARD, ctx()))
    calls = len(runner.calls)
    assert first.state == "done" and calls == 3
    again = service.status(service.start(SCOREBOARD, ctx()))
    assert len(runner.calls) == calls
    assert again.state == "done"
    assert again.result["scoreboard"] == first.result["scoreboard"]


def test_identical_jobs_deduplicated(rules, cache):
    twin = TEMPLATES[SCOREBOARD].model_copy(update={"id": "pulse.party_scoreboard_twin"})
    templates = {**TEMPLATES, twin.id: twin}
    runner = FakeRunner()
    queue = ManualQueue(runner, cache)
    service, _ = make_service(rules, cache, runner=runner, queue=queue, templates=templates)
    a = service.start(SCOREBOARD, ctx())
    b = service.start(twin.id, ctx())
    assert len(queue.submitted) == 1  # one shared vote job, still in flight
    queue.drain()
    service.status(a), service.status(b)  # both runs bind and submit benchmarks
    queue.drain()
    assert runner.parts().count("vote") == 1
    assert sorted(runner.parts()) == ["seats_ac", "seats_pc", "vote"]
    assert service.status(a).state == service.status(b).state == "done"


def test_epoch_bump_invalidates(rules, cache):
    service, runner = make_service(rules, cache)
    service.status(service.start(SCOREBOARD, ctx()))
    assert len(runner.calls) == 3
    assert service.refresh_metadata(catalogue()) == 1
    assert cache.alliance_epoch() == 1
    assert service.status(service.start(SCOREBOARD, ctx())).state == "done"
    assert len(runner.calls) == 6


def test_contenders_bound_from_vote_job(rules, cache):
    service, runner = make_service(rules, cache)
    service.status(service.start(SCOREBOARD, ctx()))
    assert runner.parts()[0] == "vote"
    benches = [c for c in runner.calls if "benchmark" in c]
    assert len(benches) == 2
    for config in benches:
        # NOTA (competition_excluded) and Other (other_label) are not contenders.
        assert config["benchmark"]["contenders"] == ["BSP", "NDA", "SP+"]


def test_failed_job_marks_only_its_parts(rules, cache):
    runner = FakeRunner({"seats_pc": [ValueError("Missing population factor")]})
    service, _ = make_service(rules, cache, runner=runner)
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert status.state == "partial"
    assert set(status.errors) == {"seats_pc"}
    assert status.errors["seats_pc"]["kind"] == "config"
    assert status.errors["seats_pc"]["message"] == "Missing population factor"
    nda = board(status)["NDA"]
    assert nda["vote"]["value"] == 38.0 and nda["vote"]["delta"] == -1.5
    assert nda["seats_ac"]["value"] == 154 and nda["seats_ac"]["delta"] == -88
    assert nda["seats_pc"] is None
    assert runner.parts().count("seats_pc") == 1  # config errors never retry
    # Cached successes stay usable: a new run re-uses vote and AC.
    rerun = service.status(service.start(SCOREBOARD, ctx()))
    assert rerun.state == "partial"
    assert len(runner.calls) == 3  # the config error is cached too


def test_infrastructure_error_retried_then_succeeds(rules, cache):
    runner = FakeRunner({"vote": [ConnectionError("reset"), ConnectionError("reset")]})
    sleeps: list[float] = []
    service, _ = make_service(rules, cache, runner=runner, sleeps=sleeps)
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert status.state == "done" and status.errors == {}
    assert runner.parts().count("vote") == 3
    assert sleeps == [5, 15]


def test_infrastructure_error_gives_up_after_three_retries(rules, cache):
    runner = FakeRunner({"vote": [ConnectionError("down")] * 4})
    sleeps: list[float] = []
    service, _ = make_service(rules, cache, runner=runner, sleeps=sleeps)
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert runner.parts() == ["vote"] * 4
    assert sleeps == [5, 15, 30]
    assert status.state == "failed" and status.result is None
    assert status.errors["vote"]["kind"] == "infrastructure"
    # Dependent seat jobs fail with the vote job's kind, without running.
    assert status.errors["seats_ac"]["kind"] == "infrastructure"
    # An infrastructure error is not a cached verdict: the next run retries.
    assert service.status(service.start(SCOREBOARD, ctx())).state == "done"


def test_config_error_not_retried(rules, cache):
    runner = FakeRunner({"vote": [ValueError("unknown field"), ValueError("unknown field")]})
    sleeps: list[float] = []
    service, _ = make_service(rules, cache, runner=runner, sleeps=sleeps)
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert runner.parts() == ["vote"]
    assert sleeps == []
    assert status.state == "failed"
    assert status.errors["vote"]["kind"] == "config"


def test_too_heavy_error_not_retried(rules, cache):
    runner = FakeRunner({"vote": [EngineError("too_heavy", "TOO_BIG_AST")]})
    service, _ = make_service(rules, cache, runner=runner)
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert runner.parts() == ["vote"]
    assert status.errors["vote"]["kind"] == "too_heavy"


def test_series_carry_label_and_colour(rules, cache):
    service, _ = make_service(rules, cache)
    status = service.status(service.start(SCOREBOARD, ctx()))
    rows = status.result["scoreboard"]
    assert [r["series"] for r in rows] == ["NDA", "SP+", "BSP", "Other"]
    assert status.result["hidden_count"] == 1  # NOTA hidden by rule, counted
    nda, sp = rows[0], rows[1]
    assert (nda["label"], nda["colour"]) == ("NDA (BJP+)", "#FF9933")
    assert (sp["label"], sp["colour"]) == ("SP+", "#E41A1C")
    assert rows[2]["colour"] is None
    assert sp["vote"] == {"value": 34.0, "delta": 3.5, "trend": [30.0, 34.0],
                          "secondary": None, "flags": []}
    assert status.result["rules_version"] == rules.version


def test_result_rounds_and_coverage(rules, cache):
    service, _ = make_service(rules, cache)
    result = service.status(service.start(SCOREBOARD, ctx())).result
    rounds = result["rounds"]
    assert [r["obs_id"] for r in rounds["items"]] == ["o1", "o2"]
    r1, r2 = rounds["items"]
    assert (r1["version"], r1["fallback"], r1["seats"]) == ("normal", True, 380)
    assert (r2["version"], r2["fallback"], r2["seats"], r2["borrowed"]) == (
        "extrapolated", False, 403, 23)
    assert rounds["anchor"] == "o2" and rounds["compare"] == "o1"
    assert rounds["groups"] == [{"cycle": "2027 VS", "series": r1["series"],
                                 "obs_ids": ["o1", "o2"]}]
    coverage = {c["part"]: c["coverage"] for c in result["coverage"]}
    assert coverage == {"vote": {"mode": "independent"}, "seats_ac": BENCH_COVERAGE,
                        "seats_pc": BENCH_COVERAGE}


def test_status_progress_counts(rules, cache):
    runner = FakeRunner()
    queue = ManualQueue(runner, cache)
    service, _ = make_service(rules, cache, runner=runner, queue=queue)
    run_id = service.start(SCOREBOARD, ctx())
    status = service.status(run_id)
    assert (status.state, status.done, status.total, status.result) == ("running", 0, 3, None)
    assert runner.calls == []
    queue.drain()  # vote finishes; benchmarks are bound and submitted on poll
    status = service.status(run_id)
    assert (status.state, status.done, status.total) == ("running", 1, 3)
    assert len(queue.pending) == 2
    queue.drain()
    status = service.status(run_id)
    assert (status.state, status.done, status.total) == ("done", 3, 3)
    assert status.result is not None


def test_opinion_card_cells(rules, cache):
    service, _ = make_service(rules, cache)
    status = service.status(service.start("pulse.leaders", ctx()))
    assert status.state == "done"
    cells = {c["series"]: c for c in status.result["opinion"]}
    assert list(cells) == ["cm_satisfaction", "pm_satisfaction"]  # append_alpha default
    assert cells["pm_satisfaction"]["cell"]["value"] == 25.0
    assert cells["pm_satisfaction"]["cell"]["delta"] == 4.0  # engine, not 25 - 20
    assert cells["pm_satisfaction"]["label"] == "pm_satisfaction"
    assert status.result["not_returned"] == ["state_govt_satisfaction",
                                             "central_govt_satisfaction"]


def test_zone_card_grid(rules, cache):
    service, _ = make_service(rules, cache)
    status = service.status(service.start("pulse.by_zone", ctx()))
    assert status.state == "done"
    grid = status.result["grid"]
    assert grid["row_dim"] == "party_zone"
    assert [r["value"] for r in grid["rows"]] == ["Bundelkhand", "Rohilkhand"]
    first = grid["rows"][0]["series"]
    assert [s["series"] for s in first] == ["NDA", "SP+"]
    assert first[0]["cell"]["value"] == 45.0 and first[0]["label"] == "NDA (BJP+)"


def test_unknown_run_and_card(rules, cache):
    service, _ = make_service(rules, cache)
    with pytest.raises(KeyError):
        service.status("nope")
    with pytest.raises(KeyError):
        service.start("pulse.missing", ctx())


def test_job_log_lines_have_required_fields(rules, cache, caplog):
    service, _ = make_service(rules, cache)
    with caplog.at_level(logging.INFO, logger="matbodh_dashboard.runner"):
        service.status(service.start(SCOREBOARD, ctx()))
        service.status(service.start(SCOREBOARD, ctx()))
    lines = [json.loads(r.getMessage()) for r in caplog.records
             if r.name == "matbodh_dashboard.runner.service"]
    assert len(lines) == 6  # one per job per run
    fields = {"fingerprint", "card_id", "part", "state", "queue_wait_s", "engine_s",
              "rows", "cache_hit", "error_kind", "engine_version", "metadata_revision"}
    assert all(set(line) == fields for line in lines)
    assert [line["cache_hit"] for line in lines] == [False] * 3 + [True] * 3
    first = lines[0]
    assert first["part"] == "vote" and first["state"] == "done"
    assert first["rows"] == 12 and first["engine_s"] is not None
    assert first["error_kind"] is None and first["engine_version"] == "0.8.0"


def test_rq_queue_enqueues_each_fingerprint_once(cache):
    redis = fakeredis.FakeStrictRedis()
    queue = RQQueue(redis, cache)
    queue.submit("fp1", {"a": 1})
    queue.submit("fp1", {"a": 1})
    from rq import Queue

    rq_queue = Queue("engine", connection=redis)
    assert rq_queue.job_ids == ["fp1"]
    job = rq_queue.fetch_job("fp1")
    assert job.func_name == "matbodh_dashboard.runner.worker.execute"
    assert job.args == ("fp1", {"a": 1})
    assert job.retries_left == 3 and job.retry_intervals == [5, 15, 30]
    assert queue.state("fp1") == "queued"
    cache.put("fp1", {"rows": []})
    assert queue.state("fp1") == "done"


def test_cache_round_trip_and_errors(cache):
    assert cache.get("x") is None and cache.error("x") is None
    cache.put_error("x", EngineError("config", "bad"))
    assert cache.error("x") == {"kind": "config", "message": "bad"}
    cache.put("x", {"rows": [{"v": None}]})
    assert cache.get("x") == {"rows": [{"v": None}]}
    assert cache.error("x") is None  # a stored result supersedes an earlier error
    assert cache.alliance_epoch() == 0
    assert cache.bump_epoch() == 1 and cache.alliance_epoch() == 1
    with pytest.raises(ValueError):
        ResultCache(fakeredis.FakeStrictRedis(), ttl_seconds=0)


def test_worker_stores_result_or_classified_error(cache, monkeypatch):
    from matbodh_dashboard.runner import worker

    runner = FakeRunner({"vote": [ValueError("bad"), ConnectionError("down"),
                                  ConnectionError("down")]})
    monkeypatch.setattr(worker, "_resources", lambda: (runner, cache))
    config = {"request": {"scenarios": [VOTE_SCENARIO], "grouping_sets": [[]],
                          "observations": [{"id": "o1"}], "comparisons": []}}
    worker.execute("cfg", config)  # config error: stored, not raised (no RQ retry)
    assert cache.error("cfg") == {"kind": "config", "message": "bad"}

    monkeypatch.setattr(worker, "_retries_left", lambda: 2)
    with pytest.raises(EngineError):  # infrastructure with retries left: RQ retries
        worker.execute("infra", config)
    assert cache.error("infra") is None
    monkeypatch.setattr(worker, "_retries_left", lambda: 0)
    worker.execute("infra", config)  # last attempt: the error is stored
    assert cache.error("infra")["kind"] == "infrastructure"

    worker.execute("ok", config)
    assert cache.get("ok")["rows"][0]["support_share"] == 40.0
