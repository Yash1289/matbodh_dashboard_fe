from datetime import datetime, timezone

from matbodh_dashboard.cohorts.models import CohortRef
from matbodh_dashboard.runner import service as service_module
from tests.runner.test_service import VOTE, cache, ctx, make_service, rules  # noqa: F401

COHORT = CohortRef(seat_level="ac", seat_ids=[5, 2], label="Two seats",
                   created_at=datetime(2026, 11, 18, tzinfo=timezone.utc))


def _spy(monkeypatch):
    seen = []
    real = service_module.compile_card

    def wrapper(*args, **kwargs):
        seen.append(kwargs.get("cohort", "missing"))
        return real(*args, **kwargs)

    monkeypatch.setattr(service_module, "compile_card", wrapper)
    return seen


def test_plan_and_start_pass_the_context_cohort_to_the_compiler(monkeypatch, rules, cache):  # noqa: F811
    service, _ = make_service(rules, cache)
    seen = _spy(monkeypatch)
    service.plan(VOTE.id, ctx(cohort=COHORT))
    service.start(VOTE.id, ctx(cohort=COHORT))
    assert seen == [COHORT, COHORT]


def test_no_cohort_passes_none(monkeypatch, rules, cache):  # noqa: F811
    service, _ = make_service(rules, cache)
    seen = _spy(monkeypatch)
    service.plan(VOTE.id, ctx())
    assert seen == [None]
