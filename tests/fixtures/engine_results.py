"""Synthetic engine results shaped like dataclasses.asdict(AnalysisResult/BenchmarkResult)."""

from __future__ import annotations


def analysis_result() -> dict:
    caste_obc = {"caste": {"value": "OBC", "is_subtotal": False}}
    return {
        "rows": [
            {"observation_id": "obs1", "scenario_id": "vote", "party_id": "BJP",
             "support_share": 41.5, "weighted_denominator": 812.25,
             "grouping_set_id": "g1", "unit": "percentage",
             "dimensions": {**caste_obc, "gender": {"value": None, "is_subtotal": True}}},
            {"observation_id": "obs1", "scenario_id": "vote", "party_id": "SP",
             "support_share": 33.0, "weighted_denominator": 812.25,
             "grouping_set_id": "g1", "unit": "percentage",
             "dimensions": {**caste_obc, "gender": {"value": None, "is_subtotal": True}}},
            # Opinion rows: engine popped party_id and kept option_id; the same
            # option label appears in two scenarios.
            {"observation_id": "obs2", "scenario_id": "pm_satisfaction",
             "option_id": "Completely Satisfied", "support_share": 20.0,
             "weighted_denominator": 400.0, "grouping_set_id": "g1", "dimensions": {}},
            {"observation_id": "obs2", "scenario_id": "cm_satisfaction",
             "option_id": "Completely Satisfied", "support_share": 12.0,
             "weighted_denominator": 400.0, "grouping_set_id": "g1", "dimensions": {}},
            {"observation_id": "obs_dead", "scenario_id": "vote", "party_id": "BJP",
             "support_share": 99.0, "weighted_denominator": 1.0,
             "grouping_set_id": "g1", "unit": "percentage", "dimensions": {}},
        ],
        "comparisons": [
            # Engine delta (5.0) deliberately != 41.5 - 33.0 (= 8.5).
            {"comparison_id": "c1", "party_id": "BJP", "measure": "support_share",
             "percentage_point_difference": 5.0, "relative_change_pct": 12.0,
             "size_of_impact_pp": 0.4, "target": ["obs1", "vote"],
             "reference": ["obs0", "vote"], "coverage_status": "aligned",
             "dimensions": caste_obc},
            {"comparison_id": "c2", "option_id": "Completely Satisfied",
             "measure": "support_share", "percentage_point_difference": -2.5,
             "target": ["obs2", "pm_satisfaction"], "reference": ["obs3", "pm_satisfaction"],
             "coverage_status": "aligned", "dimensions": {}},
            {"comparison_id": "c2b", "option_id": "Completely Satisfied",
             "measure": "support_share", "percentage_point_difference": 1.5,
             "target": ["obs2", "cm_satisfaction"], "reference": ["obs3", "cm_satisfaction"],
             "coverage_status": "aligned", "dimensions": {}},
            {"comparison_id": "c3", "measure": "net_score",
             "percentage_point_difference": -4.0, "target": ["obs2", "approval"],
             "reference": ["obs3", "approval"], "dimensions": {}},
            {"comparison_id": "c4", "party_id": "SP", "measure": "support_share",
             "percentage_point_difference": None, "target": ["obs1", "vote"],
             "reference": ["obs0", "vote"], "coverage_status": "zero_base",
             "dimensions": {}},
        ],
        "scores": [
            {"observation_id": "obs2", "scenario_id": "approval", "grouping_set_id": "g1",
             "positive_share": 55.0, "negative_share": 30.0, "net_score": 25.0,
             "weighted_denominator": 400.0, "coverage_status": "available",
             "dimensions": {}},
            {"observation_id": "obs4", "scenario_id": "approval", "grouping_set_id": "g1",
             "positive_share": None, "negative_share": None, "net_score": None,
             "weighted_denominator": 0.0, "coverage_status": "zero_base",
             "dimensions": {}},
        ],
        "populations": [],
        "gender_differentials": [
            {"observation_id": "obs1", "scenario_id": "vote", "party_id": "BJP",
             "gender_differential_pp": -3.25, "female_support_share": 39.0,
             "male_support_share": 42.25, "coverage_status": "available",
             "dimensions": caste_obc},
            {"observation_id": "obs1", "scenario_id": "vote", "party_id": "SP",
             "gender_differential_pp": 0.0, "female_support_share": 0.0,
             "male_support_share": 0.0, "coverage_status": "missing_or_zero_gender_base",
             "dimensions": {}},
        ],
        "context_status": {"obs1:vote": "available", "obs_dead:vote": "no_eligible_result",
                           "obs2:approval": "available", "obs4:approval": "available"},
        "contract": {},
    }


def benchmark_result() -> dict:
    caste = '{"caste": "OBC"}'
    return {
        "seat_results": [], "margin_buckets": [], "flips": [], "coverage": [],
        "summaries": [
            {"endpoint": "tgt", "party_id": "BJP", "seat_count": 180, "vote_share": 41.0,
             "eligible_seat_count": 403, "support_base": 9000.5, "grouping_set_id": "g0",
             "dimensions": "{}"},
            {"endpoint": "ref", "party_id": "BJP", "seat_count": 255, "vote_share": 41.5,
             "eligible_seat_count": 403, "support_base": 9100.0, "grouping_set_id": "g0",
             "dimensions": "{}"},
            {"endpoint": "tgt", "party_id": "BJP", "seat_count": 60, "vote_share": 44.0,
             "eligible_seat_count": 120, "support_base": 2500.0, "grouping_set_id": "g1",
             "dimensions": caste},
        ],
        "comparisons": [
            # Delta 7 != 180 - 255: engine value must be copied verbatim.
            {"party_id": "BJP", "seat_count_delta": 7, "vote_share_delta_pp": -0.5,
             "target_seat_count": 180, "reference_seat_count": 255,
             "eligible_seat_count": 403, "grouping_set_id": "g0", "dimensions": "{}"},
            {"party_id": "BJP", "seat_count_delta": -3, "vote_share_delta_pp": 1.0,
             "target_seat_count": 60, "reference_seat_count": 63,
             "eligible_seat_count": 120, "grouping_set_id": "g1", "dimensions": caste},
        ],
        "contract": {"id": "bm1", "seat_level": "ac", "state": "Uttar Pradesh", "target": "tgt"},
    }
