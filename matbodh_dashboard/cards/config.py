"""Card configuration: what a card computes (spec section 5).

A CardConfig is loaded from config/cards/*.yaml now and edited by the Configure
modal later. Fixed numerical policy lives in the admin preset, never here.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

Family = Literal["distribution", "opinion", "gender_differential"]
Mode = Literal["standalone", "compare", "trend"]

# ac_num and pc_num are seat-level; district is treated as seat-level until verified
# (spec section 13.1). party_zone and zone are zone-only.
SEAT_DIMENSIONS = frozenset({"ac_num", "pc_num", "district"})
OPINION_MEASURES = ("net_score", "positive_share", "negative_share")
PARTY_MEASURES = ("support_share",)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FilterSpec(_Strict):
    field: str
    operator: Literal["in", "not_in"] = "in"
    values: list[str] = Field(min_length=1)


class Endpoint(_Strict):
    """A round plus a scenario. round: 'anchor', 'compare' or a selected round name."""

    round: str = "anchor"
    scenario: str


class ComparisonConfig(_Strict):
    mode: Mode = "standalone"
    target: Endpoint | None = None
    reference: Endpoint | None = None
    delta_measures: list[str] = Field(default_factory=list)


class Requirements(_Strict):
    min_level: Literal["state", "ac"] = "state"


@lru_cache(maxsize=1)
def _scenario_catalogue():
    from matbodh_dash.catalog import default_scenarios

    return default_scenarios()


def scenario_kind(scenario_id: str) -> Literal["party", "opinion"]:
    scenario = _scenario_catalogue().get(scenario_id)
    if scenario is None:
        raise ValueError(f"unknown scenario {scenario_id!r}")
    if scenario.domain == "party":
        return "party"
    if scenario.domain in ("ordinal", "boolean"):
        return "opinion"
    raise ValueError(f"scenario {scenario_id!r} has unsupported domain {scenario.domain!r}")


def comparison_kind(target_kind: str, reference_kind: str) -> Literal["difference", "shakti"]:
    if target_kind == reference_kind:
        return "difference"
    if target_kind == "party" and reference_kind == "opinion":
        return "shakti"
    raise ValueError("an opinion target cannot be compared with a party reference")


class CardConfig(_Strict):
    id: str
    family: Family
    section: str
    title: str
    scenarios: list[str] = Field(default_factory=list)
    cuts: list[list[str]] = Field(default_factory=lambda: [[]])
    filters: list[FilterSpec] = Field(default_factory=list)
    comparison: ComparisonConfig = Field(default_factory=ComparisonConfig)
    caste_clubbing: bool = False
    requires: Requirements = Field(default_factory=Requirements)

    @model_validator(mode="after")
    def _validate(self) -> "CardConfig":
        comparison = self.comparison
        self._check_cuts()
        self._check_endpoints_and_scenarios(comparison)
        self._check_family(comparison)
        self._check_delta_measures(comparison)
        fields = [f.field for f in self.filters]
        if len(set(fields)) != len(fields):
            raise ValueError("one filter per field")
        if self.caste_clubbing and not any("caste" in cut for cut in self.cuts):
            raise ValueError("caste_clubbing needs caste in a cut")
        return self

    def _check_cuts(self) -> None:
        grains = [frozenset(cut) for cut in self.cuts]
        if len(set(grains)) != len(grains):
            raise ValueError("duplicate cut: two cuts describe the same grain")
        if self.family == "gender_differential" and any("gender" in cut for cut in self.cuts):
            raise ValueError("gender is not allowed in cuts for gender differential "
                             "(the engine removes it)")

    def _check_endpoints_and_scenarios(self, comparison: ComparisonConfig) -> None:
        if comparison.mode == "compare":
            if comparison.target is None or comparison.reference is None:
                raise ValueError("compare mode needs target and reference endpoints")
            self.scenarios = list(dict.fromkeys(
                [comparison.target.scenario, comparison.reference.scenario]))
            return
        if comparison.target is not None or comparison.reference is not None:
            raise ValueError(f"{comparison.mode} mode takes no target or reference")
        if comparison.mode == "trend" and len(self.scenarios) != 1:
            raise ValueError("trend mode needs exactly one scenario")
        if not self.scenarios:
            raise ValueError("a card needs at least one scenario")

    def _check_family(self, comparison: ComparisonConfig) -> None:
        if self.family == "gender_differential" and comparison.mode == "compare":
            raise ValueError("gender differential has no compare mode")
        wanted = "opinion" if self.family == "opinion" else "party"
        primary = ([comparison.target.scenario] if comparison.mode == "compare"
                   else self.scenarios)
        for scenario in primary:
            kind = scenario_kind(scenario)
            if kind != wanted:
                raise ValueError(f"scenario kind {kind!r} ({scenario}) is not valid "
                                 f"for the {self.family} family")

    def _check_delta_measures(self, comparison: ComparisonConfig) -> None:
        if comparison.mode != "compare":
            if comparison.delta_measures:
                raise ValueError("delta_measures apply to compare mode only")
            return
        kind = comparison_kind(scenario_kind(comparison.target.scenario),
                               scenario_kind(comparison.reference.scenario))
        if kind == "shakti":
            comparison.delta_measures = []
            return
        allowed = OPINION_MEASURES if self.family == "opinion" else PARTY_MEASURES
        if not comparison.delta_measures:
            comparison.delta_measures = [allowed[0]]
        bad = [m for m in comparison.delta_measures if m not in allowed]
        if bad:
            raise ValueError(f"delta measure {bad[0]!r} is not allowed for the "
                             f"{self.family} family; use {', '.join(allowed)}")


def load_cards(path: Path) -> dict[str, CardConfig]:
    """Load a cards YAML file (a list under `cards:`) keyed by id."""
    with Path(path).open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict) or "cards" not in data:
        raise ValueError(f"{path}: expected a top-level 'cards' list")
    cards: dict[str, CardConfig] = {}
    for raw in data["cards"]:
        card = CardConfig.model_validate(raw)
        if card.id in cards:
            raise ValueError(f"{path}: duplicate card id {card.id!r}")
        cards[card.id] = card
    return cards
