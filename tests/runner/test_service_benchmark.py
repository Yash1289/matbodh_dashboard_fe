"""Benchmark cards through the run service: one job, shared fingerprint, failure and empty results."""

from __future__ import annotations

import copy

from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
from matbodh_dashboard.cards.config import CardConfig
from tests.cards.benchmark_helpers import load_benchmark_sample
from tests.cards.test_benchmark_compile import ELECTIONS, FakeParties
from tests.runner.test_service import (  # noqa: F401  (fixtures)
    R1, R2, cache, catalogue, ctx, make_service, rules)

VS = "vs_voting_intention"
ELECTION_2022 = BenchmarkReference(kind="election", year=2022, election_type="VS")
TABLES = ("seat_results", "summaries", "margin_buckets", "coverage")


def bench_card(card_id="t.bench", table="comparison") -> CardConfig:
    return CardConfig.model_validate({
        "id": card_id, "family": "seat_benchmark", "section": "t", "title": "B", "scenarios": [VS],
        "benchmark": {"focal_party": "NDA", "grouping_sets": [[], ["party_zone"]]},
        "view": {"table": table}})


class BenchRunner:
    """Returns the live UP result, re-labelled with the endpoint ids of the config it was given."""

    def __init__(self, fail: BaseException | None = None, empty: bool = False):
        self.fail, self.empty, self.calls = fail, empty, []

    def run(self, config: dict) -> dict:
        self.calls.append(config)
        if self.fail:
            raise self.fail
        out = copy.deepcopy(load_benchmark_sample())
        ids = {"survey": "target", "historical": "reference"}
        for table in TABLES:
            for row in out[table]:
                row["endpoint"] = ids[row["endpoint"]]
        if self.empty:  # no seat common to both endpoints: numerical outputs are empty
            for table in (*TABLES, "comparisons", "flips"):
                out[table] = []
        return out


def service_with(rules, cache, runner, *cards):
    service, _ = make_service(rules, cache, runner=runner, cards={c.id: c for c in cards})
    service.major_parties, service.elections = FakeParties(), ELECTIONS
    return service


def test_benchmark_card_runs_one_job_and_assembles_a_payload(rules, cache):
    runner = BenchRunner()
    service = service_with(rules, cache, runner, bench_card())
    status = service.status(service.start("t.bench", ctx(), ELECTION_2022))
    assert status.state == "done", status.errors
    assert len(runner.calls) == 1
    assert status.result["kind"] == "benchmark" and status.result["default_table"] == "comparison"
    assert status.result["parties"] == ["BSP", "INDI", "NDA", "SP+"]
    assert status.result["reference"] == {"kind": "election", "label": "2022 VS"}


def test_two_cards_differing_only_in_view_share_one_engine_job(rules, cache):
    runner = BenchRunner()
    service = service_with(rules, cache, runner, bench_card("t.a", "comparison"), bench_card("t.b", "flips"))
    a = service.status(service.start("t.a", ctx(), ELECTION_2022))
    b = service.status(service.start("t.b", ctx(), ELECTION_2022))
    assert len(runner.calls) == 1  # the second run was a cache hit
    assert a.result["default_table"] == "comparison" and b.result["default_table"] == "flips"
    assert a.result["comparisons"] == b.result["comparisons"]


def test_changed_reference_is_a_new_fingerprint(rules, cache):
    runner = BenchRunner()
    service = service_with(rules, cache, runner, bench_card())
    service.status(service.start("t.bench", ctx(), ELECTION_2022))
    service.status(service.start("t.bench", ctx(), BenchmarkReference(kind="compare")))
    assert len(runner.calls) == 2


def test_failed_benchmark_fails_the_card_with_the_engines_message_and_no_payload(rules, cache):
    service = service_with(rules, cache, BenchRunner(fail=ValueError("Unmapped historical party IDs: ['x']")),
                           bench_card())
    status = service.status(service.start("t.bench", ctx(), ELECTION_2022))
    assert status.state == "failed" and status.result is None
    assert "Unmapped historical party IDs" in status.errors["grid"]["message"]


def test_empty_engine_tables_give_a_payload_with_empty_rows_not_an_error(rules, cache):
    service = service_with(rules, cache, BenchRunner(empty=True), bench_card())
    status = service.status(service.start("t.bench", ctx(), ELECTION_2022))
    assert status.state == "done", status.errors
    assert status.result["summaries"] == [] and status.result["comparisons"] == []
    assert status.result["tables_available"] == ["summary", "comparison", "margin_buckets", "flips"]
