import pytest
from fastapi.testclient import TestClient

from matbodh_dashboard.api.app import create_app
from tests.cards import test_ranking_compile as rank
from tests.runner.test_selection_preview import CARDS, SelectionRunner, service_with
from tests.runner.test_service import cache, rules  # noqa: F401

CONTEXT = {"state": rank.STATE, "level": "ac", "rounds": [rank.R1, rank.R2, rank.R3], "compare_round": rank.R1}


@pytest.fixture
def client(rules, cache):  # noqa: F811
    return TestClient(create_app(service_with(rules, cache, SelectionRunner())))


def post(client, card_id="ranking.seat", predicate=None, **over):
    body = {"card_id": card_id, "context": CONTEXT, "predicate": {"rank_max": 5} if predicate is None else predicate}
    body.update(over)
    return client.post("/cohorts/preview", json=body)


def test_preview_then_poll_returns_the_seat_list(client):
    response = post(client)
    assert response.status_code == 200
    status = client.get(f"/runs/{response.json()['run_id']}").json()
    assert status["state"] == "done" and status["result"]["seat_ids"] == [3, 12, 57]


def test_demographic_card_is_a_422_with_the_reason(client):
    response = post(client, "ranking.demo")
    assert response.status_code == 422 and "demographic" in response.text.lower()


def test_unknown_card_is_a_404(client):
    assert post(client, "nope").status_code == 404


def test_an_invalid_predicate_is_a_422(client):
    assert post(client, predicate={}).status_code == 422
    assert post(client, predicate={"rank_max": 3, "status": "winning"}).status_code == 422


def test_an_invalid_context_is_a_422_with_reasons(client):
    response = client.post("/cohorts/preview", json={"card_id": "ranking.seat", "predicate": {"rank_max": 5},
                                                     "context": {**CONTEXT, "rounds": ["No such round"]}})
    assert response.status_code == 422 and "unknown round" in response.text
