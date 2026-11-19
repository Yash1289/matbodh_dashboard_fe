"""Plan, run and preview a card from its own config instead of a library id (spec 8.1)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from matbodh_dashboard.api.app import create_app
from tests.api.test_app import R1, R2, STATE, client, parts, service  # noqa: F401  (fixtures)
from tests.cards import test_ranking_compile as rank
from tests.runner.test_selection_preview import SelectionRunner, service_with
from tests.runner.test_service import cache, rules  # noqa: F401  (fixtures)

VS = "vs_voting_intention"
CONTEXT = {"state": STATE, "level": "ac", "rounds": [R1, R2], "compare_round": R1}
INLINE = {"id": "mine.1", "family": "distribution", "title": "Mine", "scenarios": [VS],
          "cuts": [[], ["party_zone"]]}
RANKING = {"id": "mine.rank", "family": "seat_ranking", "title": "Rank", "scenarios": [rank.PM],
           "rank": {"metric": "net_score", "level": "ac"}}
RANK_CONTEXT = {"state": rank.STATE, "level": "ac", "rounds": [rank.R1, rank.R2, rank.R3],
                "compare_round": rank.R1}


@pytest.fixture
def preview_client(rules, cache):  # noqa: F811
    return TestClient(create_app(service_with(rules, cache, SelectionRunner())))


def inline(card=None, **extra):
    return {"card": INLINE if card is None else card, "context": CONTEXT, **extra}


def test_plan_inline_card(client):  # noqa: F811
    response = client.post("/cards/plan", json=inline())
    assert response.status_code == 200
    plan = response.json()
    assert plan["valid"] is True and plan["unavailable"] == []


def test_run_inline_card_returns_run_id(client):  # noqa: F811
    response = client.post("/cards/run", json=inline())
    assert response.status_code == 200
    status = client.get(f"/runs/{response.json()['run_id']}").json()
    assert status["state"] == "done" and status["result"]["card_id"] == "mine.1"


def test_preview_inline_card(preview_client):
    response = preview_client.post("/cohorts/preview", json={
        "card": RANKING, "context": RANK_CONTEXT, "predicate": {"rank_max": 5}})
    assert response.status_code == 200
    status = preview_client.get(f"/runs/{response.json()['run_id']}").json()
    assert status["state"] == "done" and status["result"]["seat_ids"] == [3, 12, 57]


@pytest.mark.parametrize("path, extra", [
    ("/cards/plan", {}), ("/cards/run", {}), ("/cohorts/preview", {"predicate": {"rank_max": 5}})])
def test_both_or_neither_rejected(client, path, extra):  # noqa: F811
    both = {**inline(), "card_id": "t.vote", **extra}
    neither = {"context": CONTEXT, **extra}
    for payload in (both, neither):
        response = client.post(path, json=payload)
        assert response.status_code == 422 and "exactly one of card_id or card" in response.text


def test_inline_card_limits_rejected(parts):  # noqa: F811
    service, runner = parts
    client = TestClient(create_app(service))
    too_many_values = {**INLINE, "filters": [{"field": "caste", "values": [f"c{i}" for i in range(201)]}]}
    response = client.post("/cards/run", json=inline(too_many_values))
    assert response.status_code == 422 and "at most 200 values" in response.text
    long_title = {**INLINE, "title": "x" * 201}
    response = client.post("/cards/run", json=inline(long_title))
    assert response.status_code == 422 and "title is at most 200 characters" in response.text
    too_many_cuts = {**INLINE, "cuts": [["age_group"], ["gender"], ["caste"], ["category"], ["ac_num"],
                                        ["pc_num"], ["party_zone"], ["age_group", "gender"], ["age_group", "caste"]]}
    response = client.post("/cards/run", json=inline(too_many_cuts))
    assert response.status_code == 422 and "at most 8 cuts" in response.text
    assert runner.calls == []  # nothing reached the engine


def test_inline_card_unknown_key_rejected(client):  # noqa: F811
    response = client.post("/cards/plan", json=inline({**INLINE, "surprise": 1}))
    assert response.status_code == 422 and "surprise" in response.text


def test_unknown_card_id_404(client):  # noqa: F811
    response = client.post("/cards/plan", json={"card_id": "nope", "context": CONTEXT})
    assert response.status_code == 404


def test_same_inline_card_two_clients_share_fingerprint(parts):  # noqa: F811
    service, runner = parts
    client = TestClient(create_app(service))
    first = client.post("/cards/run", json=inline({**INLINE, "id": "alice.1", "title": "Alice"}))
    second = client.post("/cards/run", json=inline({**INLINE, "id": "bob.9", "title": "Bob"}))
    assert first.status_code == second.status_code == 200
    assert len(runner.calls) == 1  # the second run was a cache hit on the same engine config


def test_inline_benchmark_and_party_lists_are_bounded(parts):  # noqa: F811
    service, runner = parts
    client = TestClient(create_app(service))
    bench = {"id": "b", "family": "seat_benchmark", "title": "B", "scenarios": [VS],
             "benchmark": {"focal_party": "NDA", "grouping_sets": [[]] + [[f"f{i}"] for i in range(8)]}}
    response = client.post("/cards/run", json=inline(bench))
    assert response.status_code == 422 and "at most 8 grouping sets" in response.text
    many = [f"P{i}" for i in range(21)]
    response = client.post("/cards/run", json=inline({**INLINE, "display_parties": many}))
    assert response.status_code == 422 and "at most 20 parties" in response.text
    response = client.post("/cards/run", json=inline({**bench, "benchmark": {"focal_party": "P0", "contenders": many}}))
    assert response.status_code == 422 and "at most 20 parties" in response.text
    response = client.post("/cards/run", json=inline({**INLINE, "id": "x" * 101}))
    assert response.status_code == 422 and "id is at most 100 characters" in response.text
    assert runner.calls == []
