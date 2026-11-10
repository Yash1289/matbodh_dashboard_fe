"""Builders for translator tests: a TranslateContext from a result, and mini results."""
from __future__ import annotations

from matbodh_dashboard.cards.translate import TranslateContext
from matbodh_dashboard.registry import RuleSet

STATE = "Uttar Pradesh"
VS = "vs_voting_intention"


def observations(result: dict) -> list[str]:
    found: set[str] = set()
    for array in ("rows", "scores", "gender_differentials", "populations"):
        found |= {i["observation_id"] for i in result.get(array) or () if i.get("observation_id")}
    for comparison in result.get("comparisons") or ():
        found |= {comparison["target"][0], comparison["reference"][0]}
    return sorted(found)


def context_for(result: dict, *, anchor: str | None = None, compare: str | None = None,
                rules: RuleSet | None = None, not_asked: list[dict] | None = None,
                obs: list[str] | None = None) -> TranslateContext:
    order = obs or observations(result)
    anchor = anchor or order[-1]
    compare = compare if compare is not None else (order[0] if order[0] != anchor else None)
    items = [{"obs_id": o, "label": f"label {o}", "base_name": o, "cycle": "c", "series": "s",
              "round": i, "dataset_id": o, "version": "normal", "fallback": False,
              "seats": 1, "borrowed": 0, "seats_source": "metadata"}
             for i, o in enumerate(order, 1)]
    return TranslateContext(
        card_id="c1", state=STATE,
        rounds={"items": items, "groups": [], "anchor": anchor, "compare": compare},
        round_order=order, labels={o: f"label {o}" for o in order}, anchor=anchor,
        compare=compare, not_asked=not_asked or [], rules=rules or RuleSet(),
        rules_version="test", engine_version="0", metadata_revision=1, alliance_epoch=0)


def dim(value, subtotal=False) -> dict:
    return {"value": value, "is_subtotal": subtotal}


def mini_row(*, obs="o1", scenario=VS, party="NDA", gs="g0", dims=None, **values) -> dict:
    row = {"observation_id": obs, "scenario_id": scenario, "party_id": party,
           "outcome_domain": "party", "grouping_set_id": gs, "dimensions": dims or {},
           "coverage_status": "available", "support_share": 40.0, "composition_share": 20.0,
           "contribution_share": None, "scenario_composition_share": None, "joint_share": None,
           "size_of_impact_pp": None, "unit": "percentage", "impact_unit": "percentage_points"}
    row.update(values)
    return row


def mini_comparison(*, target, reference, party="NDA", gs="g0", dims=None, measure="support_share",
                    pp=3.5, impact=0.9, ref_value=40.0, rel=8.75, status="aligned") -> dict:
    return {"comparison_id": f"d-{target[0]}-{reference[0]}", "kind": "difference",
            "measure": measure, "party_id": party, "target": list(target),
            "reference": list(reference), "grouping_set_id": gs, "dimensions": dims or {},
            "percentage_point_difference": pp, "size_of_impact_pp": impact, "impact_pp": impact,
            "reference_value": ref_value, "relative_change_pct": rel, "coverage_status": status,
            "impact_status": status, "target_base": 100.0, "reference_base": 90.0,
            "difference_unit": "percentage_points"}


def mini_result(rows=(), comparisons=(), populations=(), scores=()) -> dict:
    return {"rows": list(rows), "scores": list(scores), "comparisons": list(comparisons),
            "populations": list(populations), "gender_differentials": [],
            "context_status": {}, "contract": {}}
