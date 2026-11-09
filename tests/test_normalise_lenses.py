from __future__ import annotations

from matbodh_dashboard.normalise.cells import build_grid
from matbodh_dashboard.normalise.rows import from_analysis


def test_from_analysis_extracts_contribution_and_impact():
    raw = {
        "rows": [
            {
                "observation_id": "R2",
                "scenario_id": "vs_voting_intention",
                "party_id": "NDA",
                "dimensions": {"caste": {"value": "Jatav", "is_subtotal": False}},
                "support_share": 42.5,
                "contribution_share": 18.2,
                "size_of_impact_pp": 3.4,
                "composition_share": 12.0,
                "weighted_denominator": 1500.0,
            }
        ]
    }
    rows = from_analysis(raw, "Uttar Pradesh")
    measures = {r.measure: r.value for r in rows}
    assert measures["support_share"] == 42.5
    assert measures["contribution_share"] == 18.2
    assert measures["size_of_impact_pp"] == 3.4
    assert measures["composition_share"] == 12.0

    units = {r.measure: r.unit for r in rows}
    assert units["support_share"] == "pct"
    assert units["contribution_share"] == "pct"
    assert units["size_of_impact_pp"] == "pp"
    assert units["composition_share"] == "pct"


def test_build_grid_with_different_measures():
    raw = {
        "rows": [
            {
                "observation_id": "R1",
                "scenario_id": "vs_voting_intention",
                "party_id": "NDA",
                "dimensions": {"party_zone": {"value": "Jat Belt", "is_subtotal": False}},
                "support_share": 40.0,
                "contribution_share": 25.0,
                "size_of_impact_pp": 5.0,
                "composition_share": 15.0,
            },
            {
                "observation_id": "R2",
                "scenario_id": "vs_voting_intention",
                "party_id": "NDA",
                "dimensions": {"party_zone": {"value": "Jat Belt", "is_subtotal": False}},
                "support_share": 42.0,
                "contribution_share": 27.0,
                "size_of_impact_pp": 6.0,
                "composition_share": 15.0,
            },
        ]
    }
    rows = from_analysis(raw, "Uttar Pradesh")
    cells = build_grid(
        rows,
        row_dim="party_zone",
        round_ids=["R1", "R2"],
        anchor="R2",
        compare="R1",
        measure="contribution_share",
    )
    assert ("Jat Belt", "NDA") in cells
    cell = cells[("Jat Belt", "NDA")]
    assert cell.value == 27.0
    assert cell.trend == (25.0, 27.0)


def test_grid_attaches_lenses(tmp_path):
    from types import SimpleNamespace

    import fakeredis
    from matbodh_dashboard.catalogue.store import load_catalogue
    from matbodh_dashboard.registry import load_rules
    from matbodh_dashboard.runner.cache import ResultCache
    from matbodh_dashboard.runner.queue import InlineQueue
    from matbodh_dashboard.runner.service import CardRunService
    from tests.fixtures.catalogue_rows import make_query
    from tests.runner.test_service import PRESET, RULES_YAML, TEMPLATES, FakeRunner

    (tmp_path / "global.yaml").write_text(RULES_YAML, encoding="utf-8")
    cache = ResultCache(fakeredis.FakeStrictRedis(), ttl_seconds=3600)
    runner = FakeRunner()
    queue = InlineQueue(runner, cache, sleep=lambda s: None)
    service = CardRunService(
        load_catalogue(make_query()),
        PRESET,
        TEMPLATES,
        load_rules(tmp_path),
        cache,
        queue,
        "0.8.0",
    )

    template = SimpleNamespace(
        id="test.zone_lenses",
        operation="distribution",
        slices=["party_zone"],
        lenses=SimpleNamespace(
            default="support_share",
            options=["support_share", "contribution_share", "size_of_impact_pp", "composition_share"],
        ),
    )

    raw = {
        "rows": [
            {
                "observation_id": "R1",
                "scenario_id": "vs_voting_intention",
                "party_id": "NDA",
                "dimensions": {"party_zone": {"value": "Jat Belt", "is_subtotal": False}},
                "support_share": 40.0,
                "contribution_share": 25.0,
                "size_of_impact_pp": 5.0,
                "composition_share": 15.0,
            },
            {
                "observation_id": "R2",
                "scenario_id": "vs_voting_intention",
                "party_id": "NDA",
                "dimensions": {"party_zone": {"value": "Jat Belt", "is_subtotal": False}},
                "support_share": 42.0,
                "contribution_share": 27.0,
                "size_of_impact_pp": 6.0,
                "composition_share": 15.0,
            },
        ]
    }
    rows = from_analysis(raw, "Uttar Pradesh")
    grid_dict, hidden = service._grid(rows, template, "Uttar Pradesh", ["R1", "R2"], "R2", "R1", set())
    assert grid_dict["row_dim"] == "party_zone"
    row = grid_dict["rows"][0]
    assert row["value"] == "Jat Belt"
    nda_series = next(s for s in row["series"] if s["series"] == "NDA")
    assert nda_series["cell"]["value"] == 42.0
    assert "lenses" in nda_series
    lenses = nda_series["lenses"]
    assert lenses["support_share"]["value"] == 42.0
    assert lenses["contribution_share"]["value"] == 27.0
    assert lenses["size_of_impact_pp"]["value"] == 6.0
    assert lenses["composition_share"]["value"] == 15.0

