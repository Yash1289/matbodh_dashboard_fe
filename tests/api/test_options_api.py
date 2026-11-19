"""POST /configure/options: option lists for a draft card in a context (spec 7)."""

from __future__ import annotations

from tests.api.test_app import R1, R2, STATE, client, parts, service  # noqa: F401  (fixtures)

CONTEXT = {"state": STATE, "level": "ac", "rounds": [R1, R2], "compare_round": R1}


def post(client, source, params=None, card=None, **context):  # noqa: F811
    return client.post("/configure/options", json={
        "source": source, "params": params or {}, "card": card or {"family": "distribution"},
        "context": {**CONTEXT, **context}})


def test_options_listed(client):  # noqa: F811
    response = post(client, "scenarios", {"kind": "party"})
    assert response.status_code == 200
    found = response.json()
    assert "vs_voting_intention" in [i["value"] for i in found]
    assert all(set(i) >= {"value", "label", "kind", "recalled", "disabled_reason"} for i in found)


def test_unknown_source_404(client):  # noqa: F811
    assert post(client, "nope").status_code == 404


def test_bad_context_422(client):  # noqa: F811
    response = post(client, "scenarios", rounds=["No such round"])
    assert response.status_code == 422 and "unknown round" in response.text


def test_alliance_lookup_missing_is_422_with_reason(client):  # noqa: F811
    response = post(client, "parties", {"use": "focal"}, {"family": "relationship"})
    assert response.status_code == 422 and "alliance party lookup is not configured" in response.text


def test_alliance_lookup_down_is_503_without_details(service, client):  # noqa: F811
    from matbodh_dashboard.cards.benchmark.parties import AllianceUnavailable

    class Down:
        def identities(self, *a, **k):
            raise AllianceUnavailable("connect to 10.0.0.5:3306 refused")

    service.major_parties = Down()
    response = post(client, "parties", {"use": "focal"}, {"family": "relationship"})
    assert response.status_code == 503 and "10.0.0.5" not in response.text
