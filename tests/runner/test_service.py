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

# Ungrouped survey shares per round (the "parties" job). JDL, INC, Undecided
# and NOTA are outside the keep list.
PARTY_SHARES = {
    "o1": {"NDA": 40.0, "SP+": 30.0, "BSP": 12.0, "JDL": 3.0, "INC": 2.0,
           "Undecided": 2.0, "NOTA": 1.0},
    "o2": {"NDA": 38.0, "SP+": 34.0, "BSP": 11.0, "JDL": 3.5, "INC": 2.5,
           "Undecided": 2.0, "NOTA": 1.0},
}
# The grouped vote job, as the engine returns it under other_grouping: every
# party outside keep [NDA, SP+, BSP] is folded into Other (party_grouping.py),
# so it emits no JDL, INC, Undecided or NOTA rows.
SHARES = {
    "o1": {"NDA": 40.0, "SP+": 30.0, "BSP": 12.0, "Other": 8.0},
    "o2": {"NDA": 38.0, "SP+": 34.0, "BSP": 11.0, "Other": 9.0},
}
# Engine deltas deliberately differ from o2 - o1 (-2.0, 4.0).
VOTE_DELTAS = {"NDA": -1.5, "SP+": 3.5}
# Seats won per contender; a contender with no entry wins 0 seats.
SEATS = {
    "ac": {"o1": {"NDA": 243, "SP+": 158}, "o2": {"NDA": 154, "SP+": 249}},
    "pc": {"o1": {"NDA": 49, "SP+": 31}, "o2": {"NDA": 26, "SP+": 54}},
}
# Eligible (included) seats per endpoint; a paired benchmark only includes
# seats eligible in both endpoints.
ELIGIBLE = {"ac": {"o1": 380, "o2": 403, "paired": 380},
            "pc": {"o1": 76, "o2": 80, "paired": 76}}
# Paired benchmark deltas deliberately differ from the per-round gaps.
SEAT_DELTAS = {"ac": {"NDA": -88, "SP+": 90}, "pc": {"NDA": -22, "SP+": 22}}
BENCH_COVERAGE = "common_positive_eligible_seats_full_constituents"
# Seat-view vote share offset per level (real AC and PC shares differ at ~1e-14).
BENCH_SHARE_OFFSET = {"ac": 0.0, "pc": 0.0}


# A minimal grouped vote config for worker tests.
VOTE_CONFIG = {"request": {
    "scenarios": [VOTE_SCENARIO], "grouping_sets": [[]], "observations": [{"id": "o1"}],
    "comparisons": [], "parties": {"other_grouping": {"keep": ["NDA"], "label": "Other"}}}}


def part_of(config: dict) -> str:
    if "benchmark" in config:
        return f"seats_{config['benchmark']['seat_level']}"
    request = config["request"]
    if request["grouping_sets"] != [[]]:
        return "zone"
    if request["scenarios"] != [VOTE_SCENARIO]:
        return "opinion"
    return "parties" if request["parties"]["other_grouping"] is None else "vote"


def vote_result(config: dict) -> dict:
    request = config["request"]
    obs = [o["id"] for o in request["observations"]]
    shares = PARTY_SHARES if request["parties"]["other_grouping"] is None else SHARES
    rows = [
        {"observation_id": o, "scenario_id": VOTE_SCENARIO, "party_id": p,
         "support_share": v, "weighted_denominator": 1000.0, "grouping_set_id": "g0",
         "dimensions": {}}
        for o in obs for p, v in shares[o].items()
    ]
    comparisons = [
        {"comparison_id": f"{c['id']}-{p}", "party_id": p, "measure": "support_share",
         "percentage_point_difference": d, "target": c["target"],
         "reference": c["reference"], "coverage_status": "aligned", "dimensions": {}}
        for c in request["comparisons"] for p, d in VOTE_DELTAS.items()
    ]
    return {
        "rows": rows, "comparisons": comparisons, "scores": [], "populations": [],
        "gender_differentials": [],
        "context_status": {f"{o}:{VOTE_SCENARIO}": "available" for o in obs},
        "contract": {"coverage": {"mode": "independent"}},
    }


def bench_result(config: dict) -> dict:
    """Like the engine (benchmarking.py ARRAY JOIN bm_contenders): one summary
    per listed contender and endpoint, and nothing for unlisted parties."""
    b = config["benchmark"]
    level = b["seat_level"]
    target = b["target"]["id"]
    endpoints = [target] + ([b["reference"]["id"]] if b["reference"] else [])
    eligible = ELIGIBLE[level]["paired"] if b["reference"] else ELIGIBLE[level][target]
    summaries = [
        {"endpoint": e, "party_id": p, "seat_count": SEATS[level][e].get(p, 0),
         "vote_share": PARTY_SHARES[e][p] + BENCH_SHARE_OFFSET[level],
         "eligible_seat_count": eligible, "support_base": 9000.0, "grouping_set_id": "g0",
         "dimensions": {}}
        for e in endpoints for p in b["contenders"]
    ]
    comparisons = [
        {"party_id": p, "seat_count_delta": SEAT_DELTAS[level].get(p, 0),
         "eligible_seat_count": eligible, "grouping_set_id": "g0", "dimensions": {}}
        for p in b["contenders"]
    ] if b["reference"] else []
    return {
        "seat_results": [], "margin_buckets": [], "flips": [], "coverage": [],
        "summaries": summaries, "comparisons": comparisons,
        "contract": {"id": b["id"], "seat_level": level, "target": target,
                     "reference": b["reference"]["id"] if b["reference"] else None,
                     "coverage": BENCH_COVERAGE},
    }


# Net scores the engine returns per scenario and round; scenarios absent here
# (state/central government) return no scores at all.
NET = {"pm_satisfaction": {"o1": 20.0, "o2": 25.0}, "cm_satisfaction": {"o2": 5.0}}
# Engine net-score deltas deliberately differ from the gap of the displayed values.
NET_DELTAS = {"pm_satisfaction": 4.0, "cm_satisfaction": -6.0}


def opinion_result(config: dict) -> dict:
    """Only the requested scenarios, observations and comparisons, as the engine does."""
    request = config["request"]
    obs = [o["id"] for o in request["observations"]]
    scores = [
        {"observation_id": o, "scenario_id": sc, "grouping_set_id": "g0",
         "positive_share": 50.0, "negative_share": 50.0 - NET[sc][o], "net_score": NET[sc][o],
         "weighted_denominator": 900.0, "coverage_status": "available", "dimensions": {}}
        for sc in request["scenarios"] if sc in NET for o in obs
    ]
    comparisons = [
        {"comparison_id": c["id"], "measure": "net_score",
         "percentage_point_difference": NET_DELTAS[c["target"][1]], "target": c["target"],
         "reference": c["reference"], "dimensions": {}}
        for c in request["comparisons"] if c["target"][1] in NET_DELTAS
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
        return {"vote": vote_result, "parties": vote_result, "opinion": opinion_result,
                "zone": zone_result}[part](config)


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
    assert first.state == "done" and calls == 4
    again = service.status(service.start(SCOREBOARD, ctx()))
    assert len(runner.calls) == calls
    assert again.state == "done"
    assert again.result["scoreboard"] == first.result["scoreboard"]


def test_job_timings_exposes_parts_and_timings(rules, cache):
    service, _ = make_service(rules, cache)
    run_id = service.start(SCOREBOARD, ctx())
    service.status(run_id)
    timings = service.job_timings(run_id)
    assert [t["part"] for t in timings] == ["vote", "parties", "seats_ac", "seats_pc"]
    for t in timings:
        assert t["fingerprint"] and t["state"] == "done" and t["cache_hit"] is False
        assert t["engine_s"] is not None and t["engine_s"] >= 0
        assert t["queue_wait_s"] is not None
    with pytest.raises(KeyError):
        service.job_timings("nope")


def test_identical_jobs_deduplicated(rules, cache):
    twin = TEMPLATES[SCOREBOARD].model_copy(update={"id": "pulse.party_scoreboard_twin"})
    templates = {**TEMPLATES, twin.id: twin}
    runner = FakeRunner()
    queue = ManualQueue(runner, cache)
    service, _ = make_service(rules, cache, runner=runner, queue=queue, templates=templates)
    a = service.start(SCOREBOARD, ctx())
    b = service.start(twin.id, ctx())
    assert len(queue.submitted) == 2  # shared vote and parties jobs, still in flight
    queue.drain()
    service.status(a), service.status(b)  # both runs bind and submit benchmarks
    queue.drain()
    assert runner.parts().count("vote") == 1
    assert sorted(runner.parts()) == ["parties", "seats_ac", "seats_pc", "vote"]
    assert service.status(a).state == service.status(b).state == "done"


def test_epoch_bump_invalidates(rules, cache):
    service, runner = make_service(rules, cache)
    service.status(service.start(SCOREBOARD, ctx()))
    assert len(runner.calls) == 4
    assert service.refresh_metadata(catalogue()) == 1
    assert cache.alliance_epoch() == 1
    assert service.status(service.start(SCOREBOARD, ctx())).state == "done"
    assert len(runner.calls) == 8


def test_contenders_bound_from_ungrouped_parties_job(rules, cache):
    service, runner = make_service(rules, cache)
    service.status(service.start(SCOREBOARD, ctx()))
    assert runner.parts()[:2] == ["vote", "parties"]
    benches = [c for c in runner.calls if "benchmark" in c]
    assert len(benches) == 2
    for config in benches:
        # Every party the ungrouped job returns, including those the grouped
        # vote job folds into Other; NOTA (competition_excluded) is not one.
        assert config["benchmark"]["contenders"] == [
            "BSP", "INC", "JDL", "NDA", "SP+", "Undecided"]


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
    # The failed part is "failed" in every round, never "not_asked".
    assert nda["seats_pc"]["value"] is None and nda["seats_pc"]["trend"] == [None, None]
    assert "failed" in nda["seats_pc"]["flags"]
    assert "not_asked" not in nda["seats_pc"]["flags"]
    assert board(status)["Other"]["seats_pc"] is None  # never a contender
    assert runner.parts().count("seats_pc") == 1  # config errors never retry
    # Cached successes stay usable: a new run re-uses vote and AC.
    rerun = service.status(service.start(SCOREBOARD, ctx()))
    assert rerun.state == "partial"
    assert len(runner.calls) == 4  # the config error is cached too


def test_infrastructure_error_retried_then_succeeds(rules, cache):
    runner = FakeRunner({"vote": [ConnectionError("reset"), ConnectionError("reset")]})
    sleeps: list[float] = []
    service, _ = make_service(rules, cache, runner=runner, sleeps=sleeps)
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert status.state == "done" and status.errors == {}
    assert runner.parts().count("vote") == 3
    assert sleeps == [5, 15]


def test_infrastructure_error_gives_up_after_three_retries(rules, cache):
    runner = FakeRunner({"parties": [ConnectionError("down")] * 4})
    sleeps: list[float] = []
    service, _ = make_service(rules, cache, runner=runner, sleeps=sleeps)
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert runner.parts() == ["vote"] + ["parties"] * 4
    assert sleeps == [5, 15, 30]
    assert status.state == "partial"
    assert status.errors["parties"]["kind"] == "infrastructure"
    # Dependent seat jobs fail with the parties job's kind, without running.
    assert status.errors["seats_ac"]["kind"] == "infrastructure"
    assert status.errors["seats_pc"]["kind"] == "infrastructure"
    # An infrastructure error is not a cached verdict: the next run retries.
    assert service.status(service.start(SCOREBOARD, ctx())).state == "done"


def test_whole_card_fails_when_every_job_fails(rules, cache):
    runner = FakeRunner({"vote": [ValueError("bad")], "parties": [ValueError("bad")]})
    service, _ = make_service(rules, cache, runner=runner)
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert status.state == "failed" and status.result is None
    assert set(status.errors) == {"vote", "parties", "seats_ac", "seats_pc"}


def test_config_error_not_retried(rules, cache):
    runner = FakeRunner({"vote": [ValueError("unknown field"), ValueError("unknown field")]})
    sleeps: list[float] = []
    service, _ = make_service(rules, cache, runner=runner, sleeps=sleeps)
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert runner.parts().count("vote") == 1
    assert sleeps == []
    assert status.state == "partial" and set(status.errors) == {"vote"}
    assert status.errors["vote"]["kind"] == "config"


def test_too_heavy_error_not_retried(rules, cache):
    runner = FakeRunner({"vote": [EngineError("too_heavy", "TOO_BIG_AST")]})
    service, _ = make_service(rules, cache, runner=runner)
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert runner.parts().count("vote") == 1
    assert status.errors["vote"]["kind"] == "too_heavy"


def test_series_carry_label_and_colour(rules, cache):
    service, _ = make_service(rules, cache)
    status = service.status(service.start(SCOREBOARD, ctx()))
    rows = status.result["scoreboard"]
    # NOTA, INC, Undecided and JDL are inside Other (grouped vote job); none wins a seat.
    assert [r["series"] for r in rows] == ["NDA", "SP+", "BSP", "Other"]
    assert status.result["hidden_count"] == 0
    assert all(r["flags"] == [] for r in rows)
    nda, sp = rows[0], rows[1]
    assert (nda["label"], nda["colour"]) == ("NDA (BJP+)", "#FF9933")
    assert (sp["label"], sp["colour"]) == ("SP+", "#E41A1C")
    assert rows[2]["colour"] is None
    assert sp["vote"] == {"value": 34.0, "delta": 3.5, "trend": [30.0, 34.0],
                          "secondary": None, "flags": [], "base": None}
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
    assert r1["seats_source"] == r2["seats_source"] == "metadata"
    assert rounds["anchor"] == "o2" and rounds["compare"] == "o1"
    assert rounds["groups"] == [{"cycle": "2027 VS", "series": r1["series"],
                                 "obs_ids": ["o1", "o2"]}]
    coverage = {c["part"]: c["coverage"] for c in result["coverage"]}
    assert coverage == {"vote": {"mode": "independent"}, "parties": {"mode": "independent"},
                        "seats_ac": BENCH_COVERAGE, "seats_pc": BENCH_COVERAGE}


def test_status_progress_counts(rules, cache):
    runner = FakeRunner()
    queue = ManualQueue(runner, cache)
    service, _ = make_service(rules, cache, runner=runner, queue=queue)
    run_id = service.start(SCOREBOARD, ctx())
    status = service.status(run_id)
    assert (status.state, status.done, status.total, status.result) == ("running", 0, 4, None)
    assert runner.calls == []
    queue.drain()  # vote and parties finish; benchmarks are bound and submitted on poll
    status = service.status(run_id)
    assert (status.state, status.done, status.total) == ("running", 2, 4)
    assert len(queue.pending) == 2
    queue.drain()
    status = service.status(run_id)
    assert (status.state, status.done, status.total) == ("done", 4, 4)
    assert status.result is not None


def test_opinion_card_cells(rules, cache):
    service, _ = make_service(rules, cache)
    status = service.status(service.start("pulse.leaders", ctx()))
    assert status.state == "done"
    cells = {c["series"]: c for c in status.result["opinion"]}
    assert list(cells) == ["pm_satisfaction", "cm_satisfaction"]  # template order
    assert cells["pm_satisfaction"]["cell"]["value"] == 25.0
    assert cells["pm_satisfaction"]["cell"]["delta"] == 4.0  # engine, not 25 - 20
    assert cells["pm_satisfaction"]["label"] == "pm_satisfaction"
    # R1 did not ask cm_satisfaction: its own job over R2 only, no comparison.
    cm = cells["cm_satisfaction"]["cell"]
    assert cm["value"] == 5.0 and cm["trend"] == [None, 5.0]
    assert cm["delta"] is None and {"not_asked", "no_delta"} <= set(cm["flags"])
    assert status.result["not_asked"] == [{"part": "cm_satisfaction", "rounds": [R1]}]
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
    assert len(lines) == 8  # one per job per run
    fields = {"fingerprint", "card_id", "part", "state", "queue_wait_s", "engine_s",
              "rows", "cache_hit", "error_kind", "error_type", "engine_version",
              "metadata_revision"}
    assert all(set(line) == fields for line in lines)
    assert [line["cache_hit"] for line in lines] == [False] * 4 + [True] * 4
    first = lines[0]
    assert first["part"] == "vote" and first["state"] == "done"
    assert first["rows"] == 10 and first["engine_s"] is not None
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


@pytest.fixture
def seat_share_mismatch(monkeypatch):
    monkeypatch.setitem(BENCH_SHARE_OFFSET, "pc", 1e-14)


@pytest.fixture
def jdl_wins_seats(monkeypatch):
    """JDL, outside the keep list, wins seats in both rounds at both levels."""
    for level, won in (("ac", {"o1": 2, "o2": 3}), ("pc", {"o1": 1, "o2": 2})):
        for obs, n in won.items():
            monkeypatch.setitem(SEATS[level][obs], "JDL", n)


def test_seat_winner_outside_keep_gets_survey_share_from_parties_job(
        rules, cache, jdl_wins_seats, seat_share_mismatch):
    service, _ = make_service(rules, cache)
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert status.state == "done", status.errors
    # Registry order: Other is pinned last.
    assert [r["series"] for r in status.result["scoreboard"]] == [
        "NDA", "SP+", "BSP", "JDL", "Other"]
    jdl = board(status)["JDL"]
    # The ungrouped parties job's survey share, not either seat view's share.
    assert jdl["vote"]["value"] == 3.5 and jdl["vote"]["trend"] == [3.0, 3.5]
    assert jdl["vote"]["delta"] is None and "no_delta" in jdl["vote"]["flags"]
    assert "within_other" in jdl["vote"]["flags"]
    assert "vote_from_seat_view" not in jdl["vote"]["flags"]
    assert jdl["flags"] == ["within_other"]  # an "of which" row, not additive
    assert jdl["seats_ac"]["value"] == 3 and jdl["seats_pc"]["value"] == 2
    assert board(status)["Other"]["vote"]["value"] == 9.0  # still includes JDL


def test_seat_winner_row_survives_a_failed_ac_benchmark(rules, cache, jdl_wins_seats,
                                                         seat_share_mismatch):
    runner = FakeRunner({"seats_ac": [ValueError("bad AC factor")]})
    service, _ = make_service(rules, cache, runner=runner)
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert status.state == "partial" and set(status.errors) == {"seats_ac"}
    jdl = board(status)["JDL"]
    assert jdl["vote"]["value"] == 3.5
    assert jdl["seats_ac"]["value"] is None and "failed" in jdl["seats_ac"]["flags"]
    assert jdl["seats_pc"]["value"] == 2


def test_opinion_order_overridden_by_scenario_rule(tmp_path, cache):
    (tmp_path / "global.yaml").write_text(
        "rules:\n  - field: scenario\n    order: [cm_satisfaction, pm_satisfaction]\n"
        "    labels: {pm_satisfaction: PM satisfaction}\n", encoding="utf-8")
    service, _ = make_service(load_rules(tmp_path), cache)
    status = service.status(service.start("pulse.leaders", ctx()))
    cells = status.result["opinion"]
    assert [c["series"] for c in cells] == ["cm_satisfaction", "pm_satisfaction"]
    assert cells[1]["label"] == "PM satisfaction"


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


def test_log_line_reports_normalisation_error(rules, cache, caplog):
    runner = FakeRunner()
    original = runner.run

    def run(config):
        result = original(config)
        result["rows"].append({"observation_id": "o1", "scenario_id": "pm_satisfaction",
                               "support_share": 1.0, "dimensions": {}})
        return result

    runner.run = run
    service, _ = make_service(rules, cache, runner=runner)
    with caplog.at_level(logging.INFO, logger="matbodh_dashboard.runner"):
        status = service.status(service.start("pulse.leaders", ctx()))
    line = json.loads([r for r in caplog.records
                       if r.name == "matbodh_dashboard.runner.service"][0].getMessage())
    assert line["rows"] is None
    assert line["rows_error"] == "ValueError: Engine row has neither party_id nor option_id"
    assert status.state == "failed" and status.errors["assembly"]["kind"] == "config"


def test_card_with_every_part_unavailable_settles_without_jobs(rules, cache):
    from tests.fixtures.catalogue_rows import OPINION_SCENARIOS, dataset_row, level_row

    rows = [dataset_row(name, round_number=i, available_scenarios=OPINION_SCENARIOS)
            for i, name in enumerate([R1, R2], 1)]
    levels = [level_row(name, range(1, 404)) for name in (R1, R2)]
    service, runner = make_service(rules, cache)
    service.catalogue = load_catalogue(make_query(rows, levels))
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert runner.calls == []
    assert (status.state, status.done, status.total) == ("done", 0, 0)
    assert {u["part"] for u in status.result["unavailable"]} == {
        "vote", "gender_gap", "seats_ac", "seats_pc"}


def test_round_without_vote_question_is_not_asked_not_a_failed_card(rules, cache):
    from tests.fixtures.catalogue_rows import (
        DATASET_ROWS, OPINION_SCENARIOS, LEVEL_ROWS, dataset_row,
    )

    rows = [dataset_row(R1, round_number=1, available_scenarios=OPINION_SCENARIOS),
            *DATASET_ROWS[1:]]
    service, runner = make_service(rules, cache)
    service.catalogue = load_catalogue(make_query(rows, LEVEL_ROWS))
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert status.state == "done", status.errors
    for config in runner.calls:  # R1 (o1) is in no engine request
        assert [o["id"] for o in config["request"]["observations"]] == ["o2"]
    nda = board(status)["NDA"]
    assert nda["vote"]["trend"] == [None, 38.0] and nda["vote"]["value"] == 38.0
    assert {"not_asked", "no_delta"} <= set(nda["vote"]["flags"])
    assert nda["vote"]["delta"] is None
    assert nda["seats_ac"]["trend"] == [None, 154] and nda["seats_ac"]["delta"] is None
    assert {n["part"] for n in status.result["not_asked"]} == {
        "vote", "gender_gap", "seats_ac", "seats_pc"}


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
    import fakeredis
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


def test_failed_single_round_benchmark_marks_only_that_round_failed(rules, cache):
    from tests.fixtures.catalogue_rows import DATASET_ROWS, LEVEL_ROWS, dataset_row, level_row

    r3 = "2027 VS CAPI R3"
    rows = [*DATASET_ROWS, dataset_row(r3, round_number=3)]
    levels = [*LEVEL_ROWS, level_row(r3, range(1, 404))]
    for level in ("ac", "pc"):
        SEATS[level]["o3"] = {"NDA": 1, "SP+": 2}
        ELIGIBLE[level]["o3"] = 9
    PARTY_SHARES["o3"], SHARES["o3"] = PARTY_SHARES["o2"], SHARES["o2"]
    try:
        runner = FakeRunner()
        original = runner.run

        def run(config):  # the single-endpoint AC benchmark for R1 (o1) fails
            b = config.get("benchmark")
            if b and b["seat_level"] == "ac" and b["reference"] is None \
                    and b["target"]["id"] == "o1":
                raise ValueError("Missing population factor")
            return original(config)

        runner.run = run
        service, _ = make_service(rules, cache, runner=runner)
        service.catalogue = load_catalogue(make_query(rows, levels))
        status = service.status(service.start(SCOREBOARD, ctx(rounds=[R1, R2, r3],
                                                              compare_round=R2)))
        assert status.state == "partial" and set(status.errors) == {"seats_ac"}
        nda_ac = board(status)["NDA"]["seats_ac"]
        assert nda_ac["trend"] == [None, 154, 1]
        assert "failed" in nda_ac["flags"] and "not_asked" not in nda_ac["flags"]
    finally:
        for level in ("ac", "pc"):
            SEATS[level].pop("o3")
            ELIGIBLE[level].pop("o3")
        PARTY_SHARES.pop("o3"), SHARES.pop("o3")


def test_paired_seat_cells_carry_base_and_common_seat_note(rules, cache):
    service, _ = make_service(rules, cache)
    nda = board(service.status(service.start(SCOREBOARD, ctx())))["NDA"]
    assert nda["seats_ac"]["base"] == 380 and nda["seats_ac"]["secondary"] == "on 380 seats"
    assert nda["seats_pc"]["base"] == 76 and nda["seats_pc"]["secondary"] == "on 76 seats"
    assert "common_seats" in nda["seats_ac"]["flags"]
    single = make_service(rules, ResultCache(fakeredis.FakeStrictRedis(), 60))[0]
    nda = board(single.status(single.start(SCOREBOARD, ctx(compare_round=None))))["NDA"]
    assert nda["seats_ac"]["base"] == 403 and nda["seats_ac"]["secondary"] is None


def test_failed_opinion_job_gives_failed_cells_not_not_returned(rules, cache):
    runner = FakeRunner({"opinion": [ValueError("Unsupported outcome")]})
    service, _ = make_service(rules, cache, runner=runner)
    status = service.status(service.start("pulse.leaders", ctx()))
    assert status.state == "partial" and set(status.errors) == {"opinion"}
    cells = {c["series"]: c["cell"] for c in status.result["opinion"]}
    # The first job (pm, state and central government over R1 and R2) failed.
    for sc in ("pm_satisfaction", "state_govt_satisfaction", "central_govt_satisfaction"):
        assert cells[sc]["value"] is None and cells[sc]["trend"] == [None, None]
        assert "failed" in cells[sc]["flags"] and "not_asked" not in cells[sc]["flags"]
    assert cells["cm_satisfaction"]["value"] == 5.0
    assert status.result["not_returned"] == []


def test_api_errors_never_carry_driver_text(rules, cache, caplog):
    secret = "clickhouse://reader:hunter2@db.internal:9000"
    runner = FakeRunner({"parties": [ConnectionError(secret)] * 4,
                         "vote": [RuntimeError(secret)]})
    service, _ = make_service(rules, cache, runner=runner)
    with caplog.at_level(logging.DEBUG):
        status = service.status(service.start(SCOREBOARD, ctx()))
    assert set(status.errors) == {"vote", "parties", "seats_ac", "seats_pc"}
    for part, error in status.errors.items():
        assert "hunter2" not in error["message"] and "db.internal" not in error["message"]
        assert set(error) >= {"kind", "message", "fingerprint"}
        assert error["fingerprint"]
    assert status.errors["parties"]["kind"] == "infrastructure"
    assert status.errors["vote"]["kind"] == "config"
    # Dependants name the job that actually failed.
    assert status.errors["seats_ac"]["fingerprint"] == status.errors["parties"]["fingerprint"]
    assert "hunter2" not in caplog.text
    lines = [json.loads(r.getMessage()) for r in caplog.records
             if r.name == "matbodh_dashboard.runner.service"]
    assert {line["error_type"] for line in lines if line["part"] == "parties"} == {
        "ConnectionError"}


def test_config_error_text_reaches_the_client(rules, cache):
    runner = FakeRunner({"seats_pc": [ValueError("Missing population factor")]})
    service, _ = make_service(rules, cache, runner=runner)
    error = service.status(service.start(SCOREBOARD, ctx())).errors["seats_pc"]
    assert (error["kind"], error["message"]) == ("config", "Missing population factor")


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


@pytest.mark.parametrize("exc", [KeyError("contract"), TypeError("NoneType is not iterable")])
def test_assembly_key_and_type_errors_are_classified_not_raised(rules, cache, monkeypatch, exc):
    service, _ = make_service(rules, cache)

    def broken(run):
        raise exc

    monkeypatch.setattr(service, "_assemble", broken)
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert status.state == "failed" and status.result is None
    assert status.errors["assembly"]["kind"] == "config"
    assert type(exc).__name__ in status.errors["assembly"]["message"]


def test_failed_vote_job_marks_vote_and_gender_cells_failed(rules, cache):
    from tests.fixtures.catalogue_rows import DATASET_ROWS, LEVEL_ROWS

    runner = FakeRunner({"vote": [ValueError("Unknown/invalid dimension: gender")]})
    service, _ = make_service(rules, cache, runner=runner)
    status = service.status(service.start(SCOREBOARD, ctx()))
    nda = board(status)["NDA"]
    assert nda["vote"]["value"] is None and "failed" in nda["vote"]["flags"]
    assert "failed" in nda["gender_gap"]["flags"]
    assert nda["seats_ac"]["value"] == 154  # benchmarks depend on parties, not vote

    # Without the gender field the gender gap was never requested: no cell.
    rows = [{**r, "available_fields": ["age", "ac_num", "pc_num"]} for r in DATASET_ROWS]
    runner = FakeRunner({"vote": [ValueError("bad")]})
    service, _ = make_service(rules, ResultCache(fakeredis.FakeStrictRedis(), 60),
                              runner=runner)
    service.catalogue = load_catalogue(make_query(rows, LEVEL_ROWS))
    status = service.status(service.start(SCOREBOARD, ctx()))
    assert board(status)["NDA"]["gender_gap"] is None
    assert "gender_gap" in {u["part"] for u in status.result["unavailable"]}
