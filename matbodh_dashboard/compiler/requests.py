"""Build the exact JSON configuration the MatBodh engine accepts."""

from __future__ import annotations

from collections.abc import Sequence

from matbodh_dashboard.compiler.rounds import ResolvedRound
from matbodh_dashboard.presets import MethodPreset

SOURCES = {
    "response_table": "warehouse.sra_v2_survey_responses_rmt",
    "factor_dictionary": "warehouse.ac_population_factor_dict_v2",
    "mapping_dictionary": "warehouse.reporting_value_mapping_dict_v2",
    "mapping_table": "warehouse.reporting_value_mapping",
}


def comparison(
    target: ResolvedRound,
    reference: ResolvedRound,
    scenario: str,
    measure: str = "support_share",
    *,
    kind: str = "difference",
    reference_scenario: str | None = None,
) -> dict:
    """One engine comparison. The reference scenario defaults to the target's; give
    both when pairing two scenarios (intra-round). Ids stay unique per scenario pair
    and measure."""
    ref_scenario = reference_scenario or scenario
    pair = scenario if ref_scenario == scenario else f"{scenario}~{ref_scenario}"
    suffix = "" if measure == "support_share" else f"-{measure}"
    return {
        "id": f"d-{pair}-{target.obs_id}-{reference.obs_id}{suffix}",
        "target": [target.obs_id, scenario],
        "reference": [reference.obs_id, ref_scenario],
        "measure": measure,
        "kind": kind,
    }


def _opinion_weights(preset: MethodPreset) -> dict:
    spec = preset.opinion_weights
    out: dict = {"source": spec.source}
    if spec.scenario is not None:
        out["scenario"] = spec.scenario
    if spec.mode is not None:
        out["mode"] = spec.mode
    return out


def build_request(
    *,
    state: str,
    rounds: Sequence[ResolvedRound],
    scenarios: list[str],
    grouping_sets: list[list[str]],
    preset: MethodPreset,
    comparisons: Sequence[dict] = (),
    gender: bool = False,
    coverage_mode: str = "independent",
    other_grouping: bool = True,
    filters: Sequence[dict] = (),
    caste_clubbing: dict | None = None,
    reference_observation: str | None = None,
    keep: Sequence[str] | None = None,
) -> dict:
    if not rounds:
        raise ValueError("at least one resolved round is required")
    latest = max(rounds, key=lambda r: r.identity.sort_key)
    return {
        "id": "dashboard",
        "state": state,
        "observations": [
            {"id": r.obs_id, "survey_name": r.dataset.survey_name} for r in rounds
        ],
        "scenarios": list(scenarios),
        "grouping_sets": [list(gs) for gs in grouping_sets],
        "weights": {
            "mode": preset.weights.mode,
            "invalid": preset.weights.invalid,
            "zero": preset.weights.zero,
        },
        "answers": {
            "excluded": list(preset.answers_excluded),
            "strip_whitespace": preset.strip_whitespace,
            "policy_id": "all_answered_options",
        },
        "parties": {
            "passthrough": preset.passthrough,
            "options": [],
            "other_grouping": (
                {"keep": list(preset.keep if keep is None else keep), "label": preset.other_label}
                if other_grouping
                else None
            ),
        },
        "geography_path": "ac_hierarchy",
        "filters": [dict(f) for f in filters],
        "display_parties": [],
        "comparisons": [dict(c) for c in comparisons],
        "reference_observation": (
            reference_observation if reference_observation is not None
            else latest.obs_id if coverage_mode == "common" else None
        ),
        "coverage_mode": coverage_mode,
        "opinion_weights": _opinion_weights(preset),
        "caste_clubbing": dict(caste_clubbing) if caste_clubbing else None,
        "gender_differential": (
            {
                "field": preset.gender.field,
                "female_values": list(preset.gender.female),
                "male_values": list(preset.gender.male),
            }
            if gender
            else None
        ),
    }


def view_config(request: dict, preset: MethodPreset, **operations: object) -> dict:
    """Wrap a request with sources, alliances and optional operations."""
    return {
        "sources": dict(SOURCES),
        "request": request,
        "alliances": {"reporting_type": preset.alliance_reporting_type},
        **operations,
    }
