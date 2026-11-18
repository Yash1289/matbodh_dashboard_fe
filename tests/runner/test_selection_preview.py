import pytest

from matbodh_dashboard.cards.cohort.compile import SelectionPredicate
from matbodh_dashboard.runner.service import CohortUnavailable
from tests.cards import test_ranking_compile as rank
from tests.runner.test_service import FakeRunner, cache, make_service, rules  # noqa: F401

CARD_COMPARE = rank._seat(id="ranking.compare", scenarios=[], comparison={
    "mode": "compare", "target": {"scenario": rank.PM}, "reference": {"round": "compare", "scenario": rank.PM}})
CARDS = {c.id: c for c in (rank._seat(), CARD_COMPARE, rank._demographic())}


class SelectionRunner(FakeRunner):
    """Returns the engine's selection shape for a selection config, with scripted seat ids."""

    def __init__(self, ids=("57", "3", "12")):
        super().__init__()
        self.ids = ids

    def run(self, config):
        if "selection" in config:
            self.calls.append(config)
            return {"selection_rows": [{"seat_id": i} for i in self.ids], "result": {}, "contract": {}}
        return super().run(config)


def service_with(rules, cache, runner):  # noqa: F811
    service, _ = make_service(rules, cache, runner=runner, cards=CARDS, cat=rank._catalogue())
    return service


def preview(service, card_id="ranking.seat", predicate=None):
    run_id = service.start_selection(card_id, rank._ctx(), predicate or SelectionPredicate(rank_max=5))
    return service.status(run_id)


def test_preview_run_returns_ids_count_and_level(rules, cache):  # noqa: F811
    runner = SelectionRunner()
    status = preview(service_with(rules, cache, runner))
    assert status.state == "done"
    assert status.result == {"kind": "cohort_preview", "seat_level": "ac", "seat_ids": [3, 12, 57], "count": 3}
    assert len(runner.calls) == 1 and runner.calls[0]["selection"]["rank_max"] == 5


def test_compare_mode_ranking_previews_without_error(rules, cache):  # noqa: F811
    status = preview(service_with(rules, cache, SelectionRunner()), "ranking.compare")
    assert status.state == "done" and status.result["count"] == 3


def test_preview_with_no_matching_seats_is_count_zero_and_no_ids(rules, cache):  # noqa: F811
    status = preview(service_with(rules, cache, SelectionRunner(ids=())))
    assert status.state == "done" and status.result["count"] == 0 and status.result["seat_ids"] == []


def test_demographic_card_cannot_preview_a_cohort(rules, cache):  # noqa: F811
    service = service_with(rules, cache, SelectionRunner())
    with pytest.raises(CohortUnavailable, match="demographic"):
        service.start_selection("ranking.demo", rank._ctx(), SelectionPredicate(rank_max=5))


def test_the_same_preview_is_served_from_the_cache(rules, cache):  # noqa: F811
    runner = SelectionRunner()
    service = service_with(rules, cache, runner)
    preview(service)
    preview(service)
    assert len(runner.calls) == 1


def test_benchmark_card_previews_through_the_service(rules, cache):  # noqa: F811
    from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
    from tests.cards import test_benchmark_compile as bench

    service, _ = make_service(rules, cache, runner=SelectionRunner(), cards={"benchmark.test": bench._card()},
                              cat=bench._catalogue())
    service.major_parties = bench.FakeParties()
    service.elections = bench.ELECTIONS
    predicate = SelectionPredicate(status="losing", margin_min=-13, margin_max=-3)
    run_id = service.start_selection("benchmark.test", bench._ctx(), predicate, BenchmarkReference(kind="compare"))
    status = service.status(run_id)
    assert status.state == "done" and status.result["seat_ids"] == [3, 12, 57]
