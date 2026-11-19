"""Card run service: cache, dedup, retries, errors and payload assembly.

No real database or Redis: fakeredis, InlineQueue / a manual queue and a fake
runner returning synthetic engine results. Every delta in the fixtures differs
from the difference of the displayed values, so a service that computed numbers
instead of copying them would fail.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import fakeredis
import pytest

from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import load_preset
from matbodh_dashboard.registry import load_rules
from matbodh_dashboard.runner.cache import ResultCache
from matbodh_dashboard.runner.engine import EngineError
from matbodh_dashboard.runner.queue import InlineQueue, RQQueue
from matbodh_dashboard.runner.service import CardRunService
from tests.fixtures.catalogue_rows import (
    DATASET_ROWS,
    LEVEL_ROWS,
    OPINION_SCENARIOS,
    dataset_row,
    level_row,
    make_query,
)

ROOT = Path(__file__).resolve().parents[2]
PRESET = load_preset(ROOT / "config/presets/uttar-pradesh.standard-v1.yaml")
STATE = "Uttar Pradesh"
R1, R2, R3 = "2027 VS CAPI R1", "2027 VS CAPI R2", "2027 VS CAPI R3"
VS = "vs_voting_intention"


def card(**overrides) -> CardConfig:
    data = {"id": "t.vote", "family": "distribution", "section": "t", "title": "Vote",
            "scenarios": [VS], "cuts": [[], ["party_zone"]]}
    data.update(overrides)
    return CardConfig.model_validate(data)


VOTE = card()
TWIN = card(id="t.vote_twin")
COMPARE = card(id="t.compare", comparison={
    "mode": "compare", "target": {"scenario": VS},
    "reference": {"round": "compare", "scenario": VS}})
TREND = card(id="t.trend", family="opinion", scenarios=["cm_satisfaction"], cuts=[[]],
             comparison={"mode": "trend"})
ACLEVEL = card(id="t.ac_level", cuts=[[]], requires={"min_level": "ac"})
CARDS = {c.id: c for c in (VOTE, TWIN, COMPARE, TREND, ACLEVEL)}

RULES_YAML = """\
rules:
  - field: party
    order: [NDA, SP+, BSP, Other, Undecided, NOTA]
    pin_last: [Other, Undecided, NOTA]
    labels: {NDA: "NDA (BJP+)"}
    colours: {NDA: "#FF9933", SP+: "#E41A1C"}
    hidden: [NOTA]
"""

SHARES = {
    "o1": {"NDA": 40.0, "SP+": 30.0, "NOTA": 1.0},
    "o2": {"NDA": 38.0, "SP+": 34.0, "NOTA": 1.0},
    "o3": {"NDA": 37.0, "SP+": 35.0, "NOTA": 1.0},
}
ZONES = ("Bundelkhand", "Rohilkhand")
# Engine deltas deliberately differ from o2 - o1 (-2.0, 4.0).
DELTAS = {"NDA": -1.5, "SP+": 3.5}
NET = {"o1": 20.0, "o2": 25.0, "o3": 27.0}


def _dim(value, subtotal=False):
    return {"party_zone": {"value": value, "is_subtotal": subtotal}}


def engine_result(config: dict) -> dict:
    """A synthetic AnalysisResult for exactly the observations, scenarios, cuts and
    comparisons the compiled request asks for."""
    request = config["request"]
    obs = [o["id"] for o in request["observations"]]
    rows, scores = [], []
    for o in obs:
        for scenario in request["scenarios"]:
            if scenario == "cm_satisfaction":
                scores.append({
                    "observation_id": o, "scenario_id": scenario, "grouping_set_id": "g0",
                    "net_score": NET[o], "positive_share": 50.0, "negative_share": 50.0 - NET[o],
                    "coverage_status": "available", "dimensions": {}})
                continue
            for gi, grouping in enumerate(request["grouping_sets"]):
                variants = ([_dim(None, True)] if not grouping
                            else [_dim(z) for z in ZONES])
                for dims in variants:
                    for party, value in SHARES[o].items():
                        rows.append({
                            "observation_id": o, "scenario_id": scenario, "party_id": party,
                            "outcome_domain": "party", "support_share": value,
                            "grouping_set_id": f"g{gi}", "dimensions": dims,
                            "coverage_status": "available", "weighted_denominator": 1000.0})
    comparisons = [
        {"comparison_id": f"{c['id']}-{p}", "party_id": p, "measure": "support_share",
         "kind": "difference", "percentage_point_difference": d, "target": c["target"],
         "reference": c["reference"], "coverage_status": "aligned", "impact_status": "aligned",
         "grouping_set_id": f"g{gi}", "dimensions": dims}
        for c in request["comparisons"] for p, d in DELTAS.items()
        for gi, grouping in enumerate(request["grouping_sets"])
        for dims in ([_dim(None, True)] if not grouping else [_dim(z) for z in ZONES])
    ]
    return {"rows": rows, "scores": scores, "comparisons": comparisons, "populations": [],
            "gender_differentials": [],
            "context_status": {f"{o}:{s}": "available" for o in obs for s in request["scenarios"]},
            "contract": {"coverage": {"mode": request["coverage_mode"]}}}


# A minimal config for worker tests (not a card): its part is "vote".
VOTE_CONFIG = {"request": {
    "id": "vote-test", "scenarios": [VS], "grouping_sets": [[]], "observations": [{"id": "o1"}],
    "comparisons": [], "parties": {"other_grouping": {"keep": ["NDA"], "label": "Other"}}}}


def part_of(config: dict) -> str:
    return "vote" if config["request"].get("id") == "vote-test" else "grid"


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
        if part == "vote":
            return {"rows": [{"observation_id": "o1", "scenario_id": VS, "party_id": "NDA",
                              "support_share": 40.0, "grouping_set_id": "g0", "dimensions": {}}],
                    "comparisons": [], "scores": [], "populations": [],
                    "gender_differentials": [], "context_status": {}, "contract": {}}
        return engine_result(config)


class FakeSession:
    """Stands in for the engine MetadataSession: records clear() calls."""

    def __init__(self):
        self.clears = 0

    def clear(self):
        self.clears += 1


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


def catalogue(rounds=(R1, R2)):
    if len(rounds) == 3:
        rows = [*DATASET_ROWS, dataset_row(R3, round_number=3)]
        levels = [*LEVEL_ROWS, level_row(R3, range(1, 404))]
        return load_catalogue(make_query(rows, levels))
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


def make_service(rules, cache, runner=None, queue=None, cards=CARDS, sleeps=None, cat=None):
    runner = runner or FakeRunner()
    if queue is None:
        recorded = sleeps if sleeps is not None else []
        queue = InlineQueue(runner, cache, sleep=recorded.append)
    service = CardRunService(cat or catalogue(), PRESET, cards, rules, cache, queue, "0.8.0")
    return service, runner


def test_cache_hit_skips_runner(rules, cache):
    service, runner = make_service(rules, cache)
    first = service.status(service.start(VOTE.id, ctx()))
    assert first.state == "done" and len(runner.calls) == 1
    again = service.status(service.start(VOTE.id, ctx()))
    assert len(runner.calls) == 1 and again.state == "done"
    assert again.result["cuts"] == first.result["cuts"]


def test_job_timings_exposes_parts_and_timings(rules, cache):
    service, _ = make_service(rules, cache)
    run_id = service.start(VOTE.id, ctx())
    service.status(run_id)
    (timing,) = service.job_timings(run_id)
    assert timing["part"] == "grid" and timing["state"] == "done" and timing["cache_hit"] is False
    assert timing["fingerprint"] and timing["engine_s"] >= 0 and timing["queue_wait_s"] is not None
    with pytest.raises(KeyError):
        service.job_timings("nope")


def test_identical_jobs_deduplicated(rules, cache):
    runner = FakeRunner()
    queue = ManualQueue(runner, cache)
    service, _ = make_service(rules, cache, runner=runner, queue=queue)
    a = service.start(VOTE.id, ctx())
    b = service.start(TWIN.id, ctx())
    assert len(queue.submitted) == 1  # the twin card compiles to the same job
    queue.drain()
    assert service.status(a).state == service.status(b).state == "done"
    assert len(runner.calls) == 1


def test_epoch_bump_invalidates(rules, cache):
    service, runner = make_service(rules, cache)
    service.status(service.start(VOTE.id, ctx()))
    assert len(runner.calls) == 1
    assert service.refresh_metadata(catalogue()) == 1
    assert cache.alliance_epoch() == 1
    assert service.status(service.start(VOTE.id, ctx())).state == "done"
    assert len(runner.calls) == 2


def test_failed_job_reports_error_and_no_payload(rules, cache):
    runner = FakeRunner({"grid": [ValueError("Missing population factor")]})
    service, _ = make_service(rules, cache, runner=runner)
    status = service.status(service.start(VOTE.id, ctx()))
    assert status.state == "failed" and status.result is None
    assert status.errors["grid"]["kind"] == "config"
    assert status.errors["grid"]["message"] == "Missing population factor"
    assert runner.parts().count("grid") == 1  # config errors never retry
    again = service.status(service.start(VOTE.id, ctx()))
    assert again.state == "failed" and len(runner.calls) == 1  # the verdict is cached


def test_infrastructure_error_retried_then_succeeds(rules, cache):
    runner = FakeRunner({"grid": [ConnectionError("reset"), ConnectionError("reset")]})
    sleeps: list[float] = []
    service, _ = make_service(rules, cache, runner=runner, sleeps=sleeps)
    status = service.status(service.start(VOTE.id, ctx()))
    assert status.state == "done" and status.errors == {}
    assert runner.parts().count("grid") == 3 and sleeps == [5, 15]


def test_infrastructure_error_gives_up_after_three_retries(rules, cache):
    runner = FakeRunner({"grid": [ConnectionError("down")] * 4})
    sleeps: list[float] = []
    service, _ = make_service(rules, cache, runner=runner, sleeps=sleeps)
    status = service.status(service.start(VOTE.id, ctx()))
    assert runner.parts() == ["grid"] * 4 and sleeps == [5, 15, 30]
    assert status.state == "failed" and status.errors["grid"]["kind"] == "infrastructure"
    # An infrastructure error is not a cached verdict: the next run retries.
    assert service.status(service.start(VOTE.id, ctx())).state == "done"


def test_config_error_not_retried(rules, cache):
    runner = FakeRunner({"grid": [ValueError("unknown field"), ValueError("unknown field")]})
    sleeps: list[float] = []
    service, _ = make_service(rules, cache, runner=runner, sleeps=sleeps)
    status = service.status(service.start(VOTE.id, ctx()))
    assert runner.parts().count("grid") == 1 and sleeps == []
    assert status.state == "failed" and status.errors["grid"]["kind"] == "config"


def test_too_heavy_error_not_retried(rules, cache):
    runner = FakeRunner({"grid": [EngineError("too_heavy", "TOO_BIG_AST")]})
    service, _ = make_service(rules, cache, runner=runner)
    status = service.status(service.start(VOTE.id, ctx()))
    assert runner.parts().count("grid") == 1 and status.errors["grid"]["kind"] == "too_heavy"


def test_result_is_a_grid_payload_with_rule_labels_and_hidden_count(rules, cache):
    service, _ = make_service(rules, cache)
    status = service.status(service.start(VOTE.id, ctx()))
    result = status.result
    assert (result["family"], result["mode"], result["card_id"]) == ("distribution", "standalone", VOTE.id)
    assert result["rounds"]["anchor"] == "o2" and result["rounds"]["compare"] == "o1"
    assert [r["obs_id"] for r in result["rounds"]["items"]] == ["o1", "o2"]
    by_key = {c["key"]: c for c in result["columns"]}
    assert (by_key[f"{VS}:NDA"]["label"], by_key[f"{VS}:NDA"]["colour"]) == ("NDA (BJP+)", "#FF9933")
    assert f"{VS}:NOTA" not in by_key and result["hidden_count"] == 1  # NOTA is hidden
    overall = next(cut for cut in result["cuts"] if cut["id"] == "g0")
    nda = next(c for c in overall["cells"] if c["column"] == f"{VS}:NDA" and c["lens"] == "support_share")
    assert nda["value"] == 38.0 and nda["round"] == "o2"
    assert result["rules_version"] == rules.version and result["engine_version"] == "0.8.0"
    assert result["coverage"] == [{"job": "grid", "part": "grid",
                                   "coverage": {"mode": "independent"}}]


def test_compare_card_deltas_are_engine_values(rules, cache):
    service, runner = make_service(rules, cache)
    status = service.status(service.start(COMPARE.id, ctx()))
    assert status.state == "done", status.errors
    assert [o["id"] for o in runner.calls[0]["request"]["observations"]] == ["o1", "o2"]
    overall = next(cut for cut in status.result["cuts"] if cut["id"] == "g0")
    delta = next(d for d in overall["deltas"] if d["column"] == f"{VS}:NDA" and d["lens"] == "support_share")
    assert delta["value"] == DELTAS["NDA"] != 38.0 - 40.0


def test_unavailable_card_settles_without_jobs(rules, cache):
    rows = [dataset_row(name, round_number=i, available_scenarios=OPINION_SCENARIOS)
            for i, name in enumerate([R1, R2], 1)]
    levels = [level_row(name, range(1, 404)) for name in (R1, R2)]
    service, runner = make_service(rules, cache, cat=load_catalogue(make_query(rows, levels)))
    status = service.status(service.start(VOTE.id, ctx()))
    assert runner.calls == []
    assert (status.state, status.done, status.total) == ("done", 0, 0)
    assert status.result["unavailable"][0]["part"] == "grid" and status.result["cuts"] == []


def test_trend_round_without_the_scenario_is_not_asked_not_a_failed_card(rules, cache):
    service, runner = make_service(rules, cache, cat=catalogue((R1, R2, R3)))
    status = service.status(service.start(TREND.id, ctx(rounds=[R1, R2, R3], compare_round=None)))
    assert status.state == "done", status.errors
    assert [o["id"] for o in runner.calls[0]["request"]["observations"]] == ["o2", "o3"]
    assert status.result["mode"] == "trend"
    assert status.result["not_asked"] == [{"part": "grid", "rounds": [R1]}]


def test_status_progress_counts(rules, cache):
    runner = FakeRunner()
    queue = ManualQueue(runner, cache)
    service, _ = make_service(rules, cache, runner=runner, queue=queue)
    run_id = service.start(VOTE.id, ctx())
    status = service.status(run_id)
    assert (status.state, status.done, status.total, status.result) == ("running", 0, 1, None)
    assert runner.calls == []
    queue.drain()
    status = service.status(run_id)
    assert (status.state, status.done, status.total) == ("done", 1, 1) and status.result


def test_unknown_run_and_card(rules, cache):
    service, _ = make_service(rules, cache)
    with pytest.raises(KeyError):
        service.status("nope")
    with pytest.raises(KeyError):
        service.start("t.missing", ctx())


def test_job_log_lines_have_required_fields(rules, cache, caplog):
    service, _ = make_service(rules, cache)
    with caplog.at_level(logging.INFO, logger="matbodh_dashboard.runner"):
        service.status(service.start(VOTE.id, ctx()))
        service.status(service.start(VOTE.id, ctx()))
    lines = [json.loads(r.getMessage()) for r in caplog.records
             if r.name == "matbodh_dashboard.runner.service"]
    assert len(lines) == 2  # one per job per run
    fields = {"fingerprint", "card_id", "part", "state", "queue_wait_s", "engine_s",
              "rows", "cache_hit", "error_kind", "error_type", "engine_version",
              "metadata_revision"}
    assert all(set(line) == fields for line in lines)
    assert [line["cache_hit"] for line in lines] == [False, True]
    first = lines[0]
    assert first["part"] == "grid" and first["state"] == "done" and first["rows"] == 9
    assert first["error_kind"] is None and first["engine_version"] == "0.8.0"


def test_api_errors_never_carry_driver_text(rules, cache, caplog):
    secret = "clickhouse://reader:hunter2@db.internal:9000"
    runner = FakeRunner({"grid": [ConnectionError(secret)] * 4})
    service, _ = make_service(rules, cache, runner=runner)
    with caplog.at_level(logging.DEBUG):
        status = service.status(service.start(VOTE.id, ctx()))
    error = status.errors["grid"]
    assert "hunter2" not in error["message"] and "db.internal" not in error["message"]
    assert set(error) >= {"kind", "message", "fingerprint"} and error["fingerprint"]
    assert error["kind"] == "infrastructure" and "hunter2" not in caplog.text
    lines = [json.loads(r.getMessage()) for r in caplog.records
             if r.name == "matbodh_dashboard.runner.service"]
    assert {line["error_type"] for line in lines} == {"ConnectionError"}


def test_config_error_text_reaches_the_client(rules, cache):
    runner = FakeRunner({"grid": [ValueError("Missing population factor")]})
    service, _ = make_service(rules, cache, runner=runner)
    error = service.status(service.start(VOTE.id, ctx())).errors["grid"]
    assert (error["kind"], error["message"]) == ("config", "Missing population factor")


@pytest.mark.parametrize("exc", [KeyError("contract"), TypeError("NoneType is not iterable")])
def test_assembly_key_and_type_errors_are_classified_not_raised(rules, cache, monkeypatch, exc):
    service, _ = make_service(rules, cache)

    def broken(run):
        raise exc

    monkeypatch.setattr(service, "_assemble", broken)
    status = service.status(service.start(VOTE.id, ctx()))
    assert status.state == "failed" and status.result is None
    assert status.errors["assembly"]["kind"] == "config"
    assert type(exc).__name__ in status.errors["assembly"]["message"]


def test_rq_queue_enqueues_each_fingerprint_once(cache):
    redis = fakeredis.FakeStrictRedis()
    queue = RQQueue(redis, cache)
    queue.submit("fp1", {"a": 1})
    queue.submit("fp1", {"a": 1})
    from rq import Queue

    rq_queue = Queue("engine", connection=redis)
    assert rq_queue.job_ids == ["fp1"]
    job = rq_queue.fetch_job("fp1")
    assert job.timeout == 300  # comfortably above the engine's 120 s query limit
    assert job.func_name == "matbodh_dashboard.runner.worker.execute"
    assert job.args == ("fp1", {"a": 1})
    assert job.retries_left == 3 and job.retry_intervals == [5, 15, 30]
    assert queue.state("fp1") == "queued"
    cache.put("fp1", {"rows": []})
    assert queue.state("fp1") == "done"


def test_cache_round_trip_and_errors(cache):
    assert cache.get("x") is None and cache.error("x") is None
    cache.put_error("x", EngineError("config", "bad", "ValueError"))
    assert cache.error("x") == {"kind": "config", "message": "bad", "type": "ValueError"}
    cache.put("x", {"rows": [{"v": None}]})
    assert cache.get("x") == {"rows": [{"v": None}]}
    assert cache.error("x") is None  # a stored result supersedes an earlier error
    assert cache.alliance_epoch() == 0
    assert cache.bump_epoch() == 1 and cache.alliance_epoch() == 1
    with pytest.raises(ValueError):
        ResultCache(fakeredis.FakeStrictRedis(), ttl_seconds=0)


def test_nan_result_is_not_cached_and_is_classified(cache):
    from matbodh_dashboard.runner.queue import attempt

    class NanRunner:
        def run(self, config):
            return {"rows": [{"support_share": float("nan")}]}

    error = attempt(NanRunner(), cache, "nan", {})
    assert error is not None and error.kind == "config"
    assert cache.get("nan") is None


def test_worker_stores_result_or_classified_error(cache, monkeypatch):
    from matbodh_dashboard.runner import worker

    runner = FakeRunner({"vote": [ValueError("bad"), ConnectionError("down"),
                                  ConnectionError("down")]})
    monkeypatch.setattr(worker, "_resources", lambda: (runner, cache, FakeSession()))
    config = dict(VOTE_CONFIG)
    worker.execute("cfg", config)  # config error: stored, not raised (no RQ retry)
    assert cache.error("cfg") == {"kind": "config", "message": "bad", "type": "ValueError"}

    monkeypatch.setattr(worker, "_retries_left", lambda: 2)
    with pytest.raises(EngineError):  # infrastructure with retries left: RQ retries
        worker.execute("infra", config)
    assert cache.error("infra") is None
    monkeypatch.setattr(worker, "_retries_left", lambda: 0)
    worker.execute("infra", config)  # last attempt: the error is stored
    assert cache.error("infra")["kind"] == "infrastructure"

    worker.execute("ok", config)
    assert cache.get("ok")["rows"][0]["support_share"] == 40.0


def test_rq_timeout_is_too_heavy_and_not_retried(cache, monkeypatch):
    from rq.timeouts import JobTimeoutException

    from matbodh_dashboard.runner import worker
    from matbodh_dashboard.runner.engine import EngineRunner

    class TimingOutRuntime:
        def run(self, path):
            raise JobTimeoutException("Task exceeded maximum timeout value (300 seconds)")

    for fp, runner in (("direct", FakeRunner({"vote": [JobTimeoutException("t")]})),
                       ("engine", EngineRunner(TimingOutRuntime()))):
        monkeypatch.setattr(worker, "_resources", lambda r=runner: (r, cache, FakeSession()))
        monkeypatch.setattr(worker, "_retries_left", lambda: 3)
        config = dict(VOTE_CONFIG)
        worker.execute(fp, config)  # stored, not raised: RQ does not retry it
        assert cache.error(fp)["kind"] == "too_heavy"


def test_worker_clears_metadata_session_when_alliance_epoch_moves(cache, monkeypatch):
    from matbodh_dashboard.runner import worker

    session = FakeSession()
    monkeypatch.setattr(worker, "_resources", lambda: (FakeRunner(), cache, session))
    monkeypatch.setattr(worker, "_seen_epoch", None)
    worker.execute("a", dict(VOTE_CONFIG))
    worker.execute("b", dict(VOTE_CONFIG))
    assert session.clears == 0  # epoch unchanged since the session was built
    cache.bump_epoch()  # POST /admin/metadata/refreshed
    worker.execute("c", dict(VOTE_CONFIG))
    assert session.clears == 1
    worker.execute("d", dict(VOTE_CONFIG))
    assert session.clears == 1  # cleared once per epoch change


def test_worker_resources_expose_the_runtime_metadata_session(monkeypatch):
    import redis

    from matbodh_dashboard.runner import worker
    from matbodh_dashboard.settings import Settings

    session = FakeSession()

    class Runtime:
        def __init__(self):
            self.session = session

    monkeypatch.setattr(worker, "_runner", None)
    monkeypatch.setattr(worker, "_cache", None)
    monkeypatch.setattr(worker, "_session", None)
    monkeypatch.setattr("matbodh_dashboard.settings.load_settings",
                        lambda: Settings(Path("x.env"), "redis://unused", 60, ROOT / "config"))
    monkeypatch.setattr(redis.Redis, "from_url",
                        classmethod(lambda cls, url: fakeredis.FakeStrictRedis()))
    monkeypatch.setattr(worker, "build_runtime", lambda env_file: Runtime())
    _, _, got = worker._resources()
    assert got is session


def test_worker_logs_type_and_fingerprint_only(cache, monkeypatch, caplog):
    from matbodh_dashboard.runner import worker

    secret = "mysql://reader:hunter2@db.internal"
    runner = FakeRunner({"vote": [ConnectionError(secret), ConnectionError(secret)]})
    monkeypatch.setattr(worker, "_resources", lambda: (runner, cache, FakeSession()))
    monkeypatch.setattr(worker, "_retries_left", lambda: 1)
    with caplog.at_level(logging.DEBUG, logger="matbodh_dashboard.runner.worker"):
        with pytest.raises(EngineError) as raised:
            worker.execute("fp-infra", dict(VOTE_CONFIG))
    # RQ logs the raised exception: no driver text and no chained cause.
    assert "hunter2" not in str(raised.value)
    assert raised.value.__cause__ is None and raised.value.__suppress_context__
    monkeypatch.setattr(worker, "_retries_left", lambda: 0)
    with caplog.at_level(logging.DEBUG, logger="matbodh_dashboard.runner.worker"):
        worker.execute("fp-infra", dict(VOTE_CONFIG))
    assert "hunter2" not in caplog.text
    assert "fp-infra" in caplog.text and "ConnectionError" in caplog.text
    assert "hunter2" not in json.dumps(cache.error("fp-infra"))


# -- benchmark runs: alliance lookups -------------------------------------------------------

BENCH = card(id="t.bench", family="seat_benchmark", section="b", title="B",
             benchmark={"focal_party": "NDA", "grouping_sets": [[]]}, cuts=[], scenarios=[VS])


class _Majors:
    def __init__(self, service_ref):
        self.service_ref, self.down, self.held_lock = service_ref, False, []

    def identities(self, state, reporting_type, *, year=None, election_type=None):
        from matbodh_dashboard.cards.benchmark.parties import AllianceUnavailable
        self.held_lock.append(self.service_ref[0]._lock._is_owned())
        if self.down:
            raise AllianceUnavailable("mysql down")
        return frozenset({"NDA", "SP+", "BSP"})


def _bench_service(rules, cache, monkeypatch):
    from matbodh_dashboard.runner import service as svc
    seen = {}

    class Payload:
        def model_dump(self):
            return {"kind": "benchmark"}

    def fake_translate(card, result, config, parties, context):
        seen["parties"] = parties
        return Payload()

    monkeypatch.setattr(svc, "translate_benchmark", fake_translate)
    ref: list = [None]
    majors = _Majors(ref)
    runner = FakeRunner()
    queue = InlineQueue(runner, cache, sleep=lambda s: None)
    service = CardRunService(catalogue(), PRESET, {BENCH.id: BENCH}, rules, cache, queue, "0.8.0",
                             major_parties=majors)
    ref[0] = service
    return service, majors, seen


def test_benchmark_endpoint_sets_are_fixed_at_start_so_a_later_lookup_failure_cannot_break_status(
        rules, cache, monkeypatch):
    service, majors, seen = _bench_service(rules, cache, monkeypatch)
    run_id = service.start(BENCH.id, ctx())
    majors.down = True  # the table goes away between start and assembly
    status = service.status(run_id)
    assert status.state == "done", status.errors
    assert seen["parties"] == {"target": frozenset({"NDA", "SP+", "BSP"}),
                               "reference": frozenset({"NDA", "SP+", "BSP"})}


def test_alliance_lookups_do_not_hold_the_service_lock(rules, cache, monkeypatch):
    service, majors, _ = _bench_service(rules, cache, monkeypatch)
    service.start(BENCH.id, ctx())
    assert majors.held_lock and not any(majors.held_lock)


# -- relationship runs ------------------------------------------------------------------------

REL = CardConfig.model_validate({
    "id": "t.rel", "family": "relationship", "section": "r", "title": "R", "cuts": [["gender"]],
    "relationship": {"origin": "vs_past", "destination": "vs_voting_intention", "focal_party": "BJP+"}})


class _RelMajors:
    def __init__(self, service_ref):
        self.service_ref, self.down, self.held_lock = service_ref, False, []

    def identities(self, state, reporting_type, *, year=None, election_type=None):
        from matbodh_dashboard.cards.benchmark.parties import AllianceUnavailable
        self.held_lock.append(self.service_ref[0]._lock._is_owned())
        if self.down:
            raise AllianceUnavailable("mysql down")
        return frozenset({"BJP+", "SP+", "BSP"})


def _rel_catalogue():
    scenarios = ["vs_past", "vs_voting_intention"]
    rows = [dataset_row(f"2027 VS CAPI R{i}", round_number=i, available_scenarios=scenarios,
                        available_fields=["gender", "ac_num"]) for i in (1, 2)]
    return load_catalogue(make_query(rows, [level_row(f"2027 VS CAPI R{i}", range(1, 404)) for i in (1, 2)]))


def _rel_service(rules, cache, runner=None):
    ref: list = [None]
    majors = _RelMajors(ref)
    runner = runner or FakeRunner()
    queue = InlineQueue(runner, cache, sleep=lambda s: None)
    service = CardRunService(_rel_catalogue(), PRESET, {REL.id: REL}, rules, cache, queue, "0.8.0",
                             major_parties=majors)
    ref[0] = service
    return service, majors


class _SampleRunner:
    """Returns the stored engine relationship result, observation ids renamed as a real run has them."""

    def run(self, config: dict) -> dict:
        from tests.cards.relationship_helpers import load_transition
        text = json.dumps(load_transition()).replace('"R1"', '"o1"').replace('"R2"', '"o2"')
        return json.loads(text)


def test_relationship_majors_are_fixed_at_start(rules, cache, monkeypatch):
    from matbodh_dashboard.runner import service as svc
    seen = {}

    class Payload:
        def model_dump(self):
            return {"kind": "relationship"}

    def fake_translate(card, result, config, majors, context):
        seen["majors"] = majors
        return Payload()

    monkeypatch.setattr(svc, "translate_relationship", fake_translate)
    service, majors = _rel_service(rules, cache)
    run_id = service.start(REL.id, ctx())
    majors.down = True  # the table goes away between start and assembly
    status = service.status(run_id)
    assert status.state == "done", status.errors
    assert seen["majors"] == frozenset({"BJP+", "SP+", "BSP"})


def test_relationship_lookups_do_not_hold_the_service_lock(rules, cache):
    service, majors = _rel_service(rules, cache)
    service.start(REL.id, ctx())
    assert majors.held_lock and not any(majors.held_lock)


def test_relationship_run_assembles_a_payload(rules, cache):
    from tests.cards.relationship_helpers import load_transition
    service, _ = _rel_service(rules, cache, runner=_SampleRunner())
    status = service.status(service.start(REL.id, ctx()))
    assert status.state == "done", status.errors
    result = status.result
    assert result["kind"] == "relationship" and result["focal_party"] == "BJP+"
    sample = next(s for s in load_transition()["summaries"]
                  if s["observation_id"] == "R2" and s["dimensions"]["gender"]["value"] == "Male")
    mine = next(s for s in result["summaries"] if s["round"] == "o2" and s["group"]["dimensions"] == {"gender": "Male"})
    assert mine["retention_share"] == sample["retention_share"]
    assert {c["origin"] for c in result["cells"]} == {"BJP+", "SP+", "BSP"}


def test_windowed_trend_payload_lists_only_window_rounds(rules, cache):
    windowed = card(id="t.trend2", family="opinion", scenarios=["cm_satisfaction"], cuts=[[]],
                    comparison={"mode": "trend"}, pipe_rounds=2)
    service, runner = make_service(rules, cache, cards={windowed.id: windowed}, cat=catalogue((R1, R2, R3)))
    status = service.status(service.start(windowed.id, ctx(rounds=[R1, R2, R3], compare_round=R1)))
    assert status.state == "done", status.errors
    assert [o["id"] for o in runner.calls[0]["request"]["observations"]] == ["o2", "o3"]
    assert [i["obs_id"] for i in status.result["rounds"]["items"]] == ["o2", "o3"]
    assert status.result["rounds"]["compare"] is None
