"""POST /cards/validate: a draft card checked by CardConfig and the engine plan, never run (spec 8.3)."""

from __future__ import annotations

from tests.api.test_app import R1, R2, STATE, client, parts, service  # noqa: F401  (fixtures)

VS, CM = "vs_voting_intention", "cm_satisfaction"
CONTEXT = {"state": STATE, "level": "ac", "rounds": [R1, R2], "compare_round": R1}
DRAFT = {"id": "mine.1", "family": "distribution", "title": "Mine", "scenarios": [VS], "cuts": [[]]}


def validate(client, draft=None, **context):  # noqa: F811
    response = client.post("/cards/validate", json={
        "card": DRAFT if draft is None else draft, "context": {**CONTEXT, **context}})
    assert response.status_code == 200, response.text
    return response.json()


def paths(result):
    return [e["path"] for e in result["errors"]]


def test_valid_draft(client):  # noqa: F811
    result = validate(client)
    assert result["valid"] is True
    assert result["errors"] == [] and result["unavailable"] == [] and result["notes"] == []
    assert [r["base_name"] for r in result["rounds"]] == [R1, R2]


def test_field_error_path_from_pydantic(client):  # noqa: F811
    draft = {"id": "d", "family": "demographic_ranking", "title": "T", "scenarios": [VS],
             "rank": {"metric": "support_share", "party_id": "NDA", "level": "caste", "top_k": 0}}
    result = validate(client, draft)
    assert result["valid"] is False and paths(result) == ["rank.top_k"]


def test_field_error_path_from_a_rule(client):  # noqa: F811
    draft = {"id": "d", "family": "demographic_ranking", "title": "T", "scenarios": [VS],
             "rank": {"metric": "support_share", "party_id": "NDA", "level": "caste", "top_k": 9}}
    result = validate(client, draft)
    assert paths(result) == ["rank.top_k"] and "top_k from 1 to 5" in result["errors"][0]["message"]
    assert not result["errors"][0]["message"].startswith("@")  # the path prefix is not shown


def test_validator_error_path(client):  # noqa: F811
    draft = {**DRAFT, "scenarios": [VS, "ls_voting_intention"], "comparison": {"mode": "trend"}}
    result = validate(client, draft)
    assert result["valid"] is False and paths(result) == ["scenarios"]


def test_unknown_key_is_an_error_at_that_key(client):  # noqa: F811
    result = validate(client, {**DRAFT, "surprise": 1})
    assert paths(result) == ["surprise"]


def test_unavailable_reason_names_the_round(client):  # noqa: F811
    draft = {"id": "d", "family": "opinion", "title": "T", "scenarios": [CM], "cuts": [[]]}
    result = validate(client, draft, anchor_round=R1, compare_round=None)  # R1 did not ask cm_satisfaction
    assert result["valid"] is False and result["errors"] == []
    (entry,) = result["unavailable"]
    assert CM in entry["reason"] and R1 in entry["reason"]


def test_field_missing_in_read_round_unavailable(client):  # noqa: F811
    result = validate(client, {**DRAFT, "cuts": [["caste"]]})  # the fixture datasets do not list caste
    assert result["valid"] is False
    assert any("caste" in e["reason"] and R2 in e["reason"] for e in result["unavailable"])


def test_a_bad_context_is_reported_not_planned(client):  # noqa: F811
    result = validate(client, rounds=["No such round"])
    assert result["valid"] is False and set(paths(result)) == {"context"}
    assert any("unknown round" in e["message"] for e in result["errors"])
    assert result["rounds"] == []  # not planned


def test_a_windowed_card_reports_its_notes(client):  # noqa: F811
    draft = {"id": "d", "family": "distribution", "title": "T", "scenarios": [VS],
             "comparison": {"mode": "trend"}, "pipe_rounds": 5}
    result = validate(client, draft)
    assert result["valid"] is True
    assert result["notes"] == ["showing 2 of the 5 rounds asked for"]


def test_validate_never_queues_jobs(parts):  # noqa: F811
    from fastapi.testclient import TestClient

    from matbodh_dashboard.api.app import create_app

    service, runner = parts
    client = TestClient(create_app(service))
    assert validate(client)["valid"] is True
    assert runner.calls == []


def test_validate_applies_the_inline_limits_on_their_field(client):  # noqa: F811
    """Validate and run must agree: a draft that run would reject with 422 is never valid here."""
    draft = {**DRAFT, "filters": [{"field": "ac_num", "values": [str(i) for i in range(1, 202)]}]}
    result = validate(client, draft)
    assert result["valid"] is False
    assert paths(result) == ["filters"] and "at most 200 values" in result["errors"][0]["message"]
