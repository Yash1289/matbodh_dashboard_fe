"""Synthetic engine results shaped like dataclasses.asdict(AnalysisResult/BenchmarkResult)."""

from __future__ import annotations


def dims(**values: object) -> dict:
    return {k: {"value": v, "is_subtotal": v is None} for k, v in values.items()}


def analysis_result() -> dict:
    return {
        "rows": [
            {"observation_id": "obs1", "scenario_id": "vote", "party_id": "BJP",
             "support_share": 41.5, "weighted_denominator": 812.25,
             "grouping_set_id": "g1", "unit": "percentage",
             "dimensions": {"caste": {"value": "OBC", "is_subtotal": False},
                            "gender": {"value": None, "is_subtotal": True}}},
            {"observation_id": "obs1", "scenario_id": "vote", "party_id": "SP",
             "support_share": 33.0, "weighted_denominator": 812.25,
             "grouping_set_id": "g1", "unit": "percentage",
             "dimensions": {"caste": {"value": "OBC", "is_subtotal": False},
                            "gender": {"value": None, "is_subtotal": True}}},
            {"observation_id": "obs_dead", "scenario_id": "vote", "party_id": "BJP",
             "support_share": 99.0, "weighted_denominator": 1.0,
             "grouping_set_id": "g1", "unit": "percentage", "dimensions": {}},
        ],
        "comparisons": [
            # Engine delta (5.0) deliberately != 41.5 - 33.0 (= 8.5).
            {"comparison_id": "c1", "party_id": "BJP", "measure": "support_share",
             "percentage_point_difference": 5.0, "relative_change_pct": 12.0,
             "size_of_impact_pp": 0.4, "target": ["obs1", "vote"],
             "reference": ["obs0", "vote"],
             "dimensions": {"caste": {"value": "OBC", "is_subtotal": False}}},
            {"comparison_id": "c2", "option_id": "opt_a", "measure": "net_score",
             "percentage_point_difference": -2.5, "relative_change_pct": None,
             "size_of_impact_pp": None, "target": ["obs2", "approval"],
             "reference": ["obs3", "approval"], "dimensions": {}},
        ],
        "scores": [
            {"observation_id": "obs2", "scenario_id": "approval", "grouping_set_id": "g1",
             "positive_share": 55.0, "negative_share": 30.0, "net_score": 25.0,
             "weighted_denominator": 400.0, "coverage_status": "available",
             "dimensions": {}},
        ],
        "populations": [],
        "gender_differentials": [
            {"observation_id": "obs1", "party_id": "BJP", "gender_differential_pp": -3.25,
             "female_support_share": 39.0, "male_support_share": 42.25,
             "coverage_status": "available",
             "dimensions": {"caste": {"value": "OBC", "is_subtotal": False}}},
            {"observation_id": "obs1", "party_id": "SP", "gender_differential_pp": 0.0,
             "female_support_share": 0.0, "male_support_share": 0.0,
             "coverage_status": "zero_base", "dimensions": {}},
        ],
        "context_status": {"obs1:vote": "available", "obs_dead:vote": "no_eligible_result",
                           "obs2:approval": "available"},
        "contract": {},
    }


def benchmark_result() -> dict:
    return {
        "seat_results": [], "margin_buckets": [], "flips": [], "coverage": [],
        "summaries": [
            {"endpoint": "tgt", "party_id": "BJP", "seat_count": 180, "vote_share": 41.0,
             "eligible_seat_count": 403, "grouping_set_id": "all"},
            {"endpoint": "ref", "party_id": "BJP", "seat_count": 255, "vote_share": 41.5,
             "eligible_seat_count": 403, "grouping_set_id": "all"},
        ],
        "comparisons": [
            # Delta 7 != 180 - 255: engine value must be copied verbatim.
            {"party_id": "BJP", "seat_count_delta": 7, "vote_share_delta_pp": -0.5,
             "target_seat_count": 180, "reference_seat_count": 255,
             "eligible_seat_count": 403, "grouping_set_id": "all"},
        ],
        "contract": {"id": "bm1", "seat_level": "ac", "state": "Uttar Pradesh", "target": "tgt"},
    }
