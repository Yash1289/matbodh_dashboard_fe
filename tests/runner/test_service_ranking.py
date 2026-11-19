"""Ranking cards through the run service: one job per round, merge and failure rules."""

from __future__ import annotations

from matbodh_dashboard.cards.config import CardConfig
from tests.runner.test_service import (  # noqa: F401  (fixtures)
    R1, R2, R3, cache, catalogue, ctx, make_service, rules)

PM = "pm_satisfaction"
SEATS = (1, 2, 3)


def seat_card(**overrides) -> CardConfig:
    data = {"id": "t.rank", "family": "seat_ranking", "section": "t", "title": "Rank",
            "scenarios": [PM], "rank": {"metric": "net_score", "level": "ac"}}
    data.update(overrides)
    return CardConfig.model_validate(data)


STANDALONE = seat_card()
TREND = seat_card(id="t.rank_trend", comparison={"mode": "trend"})
CARDS = {c.id: c for c in (STANDALONE, TREND)}


def target_obs(config: dict) -> str:
    return config["ranking"]["target"][0]


class RankRunner:
    """Synthetic seat-ranking results; scripted failures are keyed by observation id."""

    def __init__(self, failures: dict[str, list[BaseException]] | None = None):
        self.failures = {k: list(v) for k, v in (failures or {}).items()}
        self.calls: list[str] = []

    def run(self, config: dict) -> dict:
        obs = target_obs(config)
        self.calls.append(obs)
        pending = self.failures.get(obs)
        if pending:
            raise pending.pop(0)
        n = int(obs[1:])
        rows = [{"seat_id": str(s), "pool": "[]", "metric_value": 50.0 - s + n,
                 "target_value": 50.0 - s + n, "reference_value": None, "target_base": 2.0,
                 "reference_base": None, "metric_status": "available", "seat_rows": 1,
                 "eligible_seat_count": len(SEATS), "rank": s, "ranking_id": "t.rank",
                 "seat_level": "ac", "direction": "DESC", "unit": "percentage_points",
                 "partition": {}} for s in SEATS]
        return {"rows": rows, "contract": {"coverage": "strict", "direction": "DESC",
                                           "unit": "percentage_points"}}


def service_with(rules, cache, runner, cat=None):
    service, _ = make_service(rules, cache, runner=runner, cards=CARDS, cat=cat)
    return service


def test_standalone_runs_one_job_and_returns_a_ranked_payload(rules, cache):
    runner = RankRunner()
    service = service_with(rules, cache, runner)
    status = service.status(service.start(STANDALONE.id, ctx()))
    assert status.state == "done" and runner.calls == ["o2"]
    assert status.result["kind"] == "ranked" and len(status.result["entities"]) == len(SEATS)
    assert status.result["rounds"]["anchor"] == "o2"


def test_trend_non_anchor_failure_is_partial_and_refresh_reruns_only_it(rules, cache):
    runner = RankRunner({"o1": [ConnectionError("reset")] * 4})
    service = service_with(rules, cache, runner)
    status = service.status(service.start(TREND.id, ctx()))
    assert status.state == "partial"
    assert status.errors["grid"]["jobs"] == ["rank:o1"]
    assert {(a["round"], a["reason"]) for a in status.result["absent"]} == {("o1", "round_failed")}
    before = len(runner.calls)
    healed = service.status(service.start(TREND.id, ctx()))
    assert healed.state == "done" and runner.calls[before:] == ["o1"]  # o2 was a cache hit


def test_trend_anchor_failure_fails_the_card(rules, cache):
    runner = RankRunner({"o2": [ValueError("boom")]})
    service = service_with(rules, cache, runner)
    status = service.status(service.start(TREND.id, ctx()))
    assert status.state == "failed" and status.result is None
    assert status.errors["grid"]["jobs"] == ["rank:o2"]


def test_adding_a_round_runs_one_new_job(rules, cache):
    runner = RankRunner()
    service = service_with(rules, cache, runner, cat=catalogue((R1, R2, R3)))
    service.status(service.start(TREND.id, ctx()))
    assert sorted(runner.calls) == ["o1", "o2"]
    status = service.status(service.start(TREND.id, ctx(rounds=[R1, R2, R3])))
    assert status.state == "done" and runner.calls[2:] == ["o3"]


def test_engine_error_message_is_the_unavailable_reason(rules, cache):
    message = "ranking suppressed: a selected seat has a zero-base metric"
    runner = RankRunner({"o2": [ValueError(message)]})
    service = service_with(rules, cache, runner)
    status = service.status(service.start(STANDALONE.id, ctx()))
    assert status.state == "failed" and status.result is None
    assert status.errors["grid"]["kind"] == "config"
    assert status.errors["grid"]["message"] == message


def test_a_seat_label_provider_names_the_seats(rules, cache):
    class Names:
        def labels(self, state, level, seat_ids):
            return {i: {"name": f"Seat {i}"} for i in seat_ids}

    service = service_with(rules, cache, RankRunner())
    service.seat_labels = Names()
    status = service.status(service.start(STANDALONE.id, ctx()))
    assert [e["labels"]["name"] for e in status.result["entities"]] == ["Seat 1", "Seat 2", "Seat 3"]


def test_the_anchors_error_message_comes_first_and_every_failed_job_is_listed(rules, cache):
    runner = RankRunner({"o1": [ValueError("round one problem")], "o2": [ValueError("anchor problem")]})
    service = service_with(rules, cache, runner)
    status = service.status(service.start(TREND.id, ctx()))
    assert status.state == "failed" and status.result is None
    assert status.errors["grid"]["message"] == "anchor problem"
    assert sorted(status.errors["grid"]["jobs"]) == ["rank:o1", "rank:o2"]


def test_windowed_ranking_trend_payload_lists_only_window_rounds(rules, cache):
    windowed = seat_card(id="t.rank_trend2", comparison={"mode": "trend"}, pipe_rounds=2)
    runner = RankRunner()
    service, _ = make_service(rules, cache, runner=runner, cards={windowed.id: windowed},
                              cat=catalogue((R1, R2, R3)))
    status = service.status(service.start(windowed.id, ctx(rounds=[R1, R2, R3], compare_round=R1)))
    assert status.state == "done", status.errors
    assert runner.calls == ["o2", "o3"]
    assert [i["obs_id"] for i in status.result["rounds"]["items"]] == ["o2", "o3"]
