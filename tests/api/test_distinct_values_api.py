"""POST /configure/values/distinct: a filter's values from a lookup, with the engine run as the fallback."""

from __future__ import annotations

from fastapi.testclient import TestClient

from matbodh_dashboard.api.app import create_app
from tests.api.test_app import R1, R2, STATE, client, parts, service  # noqa: F401  (fixtures)

CONTEXT = {"state": STATE, "level": "ac", "rounds": [R1, R2], "compare_round": R1}


def post(client, **over):  # noqa: F811
    return client.post("/configure/values/distinct", json={"field": "gender", "context": CONTEXT, **over})


def app_with(service, query):  # noqa: F811
    return TestClient(create_app(service, values_query=query))


def test_values_come_from_the_lookup_and_are_cached(service):  # noqa: F811
    calls = []

    def query(sql, params):
        calls.append(params)
        return [("Male",), ("Female",)]

    client = app_with(service, query)  # noqa: F811
    first = post(client, mode="standalone")
    assert first.status_code == 200
    assert first.json() == {"kind": "filter_values", "field": "gender", "values": ["Female", "Male"], "source": "responses"}
    post(client, mode="standalone")
    assert len(calls) == 1  # the second ask is answered from memory
    post(client, mode="compare")  # other rounds: another key
    assert len(calls) == 2


def test_without_a_lookup_the_caller_is_sent_to_the_engine_run(client):  # noqa: F811
    assert post(client).json() == {"kind": "filter_values", "field": "gender", "values": [], "source": "engine"}


def test_unavailable_field_is_422_with_reason(service):  # noqa: F811
    client = app_with(service, lambda sql, params: [])  # noqa: F811
    response = post(client, field="not_a_field")
    assert response.status_code == 422 and "not_a_field" in response.text


def test_bad_context_and_window_are_422(service):  # noqa: F811
    client = app_with(service, lambda sql, params: [])  # noqa: F811
    assert post(client, context={**CONTEXT, "rounds": ["No such round"]}).status_code == 422
    assert post(client, pipe_rounds=0).status_code == 422
    assert post(client, mode="sideways").status_code == 422


def test_a_database_failure_is_503_without_details(service):  # noqa: F811
    def down(sql, params):
        raise ConnectionError("connect to 10.0.0.5:8123 refused")

    client = app_with(service, down)  # noqa: F811
    response = post(client)
    assert response.status_code == 503 and "10.0.0.5" not in response.text
