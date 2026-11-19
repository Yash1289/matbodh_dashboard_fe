"""Filter values through the run service: cached by fingerprint, read back like any run."""

from __future__ import annotations

import pytest

from matbodh_dashboard.runner.service import ValuesUnavailable
from tests.runner.test_service import FakeRunner, cache, catalogue, ctx, make_service, rules  # noqa: F401


class ValuesRunner(FakeRunner):
    def run(self, config):
        self.calls.append(config)
        assert config["request"]["grouping_sets"] == [["gender"]]
        return {"rows": [{"grouping_set_id": "g0", "dimensions": {"gender": {"value": v, "is_subtotal": False}}}
                         for v in ("Male", "Female", "Male")]}


def test_values_run_returns_the_distinct_values(rules, cache):  # noqa: F811
    service, runner = make_service(rules, cache, runner=ValuesRunner())
    status = service.status(service.start_values("gender", None, ctx(), None))
    assert status.state == "done", status.errors
    assert status.result == {"kind": "filter_values", "field": "gender", "values": ["Female", "Male"]}


def test_values_run_cached_by_fingerprint(rules, cache):  # noqa: F811
    service, runner = make_service(rules, cache, runner=ValuesRunner())
    service.status(service.start_values("gender", None, ctx(), None))
    service.status(service.start_values("gender", None, ctx(), None))
    assert len(runner.calls) == 1


def test_an_unavailable_values_request_raises_with_the_reason(rules, cache):  # noqa: F811
    service, runner = make_service(rules, cache, runner=ValuesRunner())
    with pytest.raises(ValuesUnavailable, match="not_a_field"):
        service.start_values("not_a_field", None, ctx(), None)
    assert runner.calls == []
