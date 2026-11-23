"""Card configuration: what a card computes (spec section 5).

A CardConfig is loaded from config/cards/*.yaml now and edited by the Configure
modal later. Fixed numerical policy lives in the admin preset, never here.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal, NoReturn

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference

Family = Literal["distribution", "opinion", "gender_differential",
                 "seat_ranking", "demographic_ranking", "seat_benchmark", "relationship"]
Mode = Literal["standalone", "compare", "trend"]
RANKING_FAMILIES = frozenset({"seat_ranking", "demographic_ranking"})
BENCHMARK_FAMILIES = frozenset({"seat_benchmark"})
RELATIONSHIP_FAMILIES = frozenset({"relationship"})
BenchmarkTable = Literal["comparison", "summary", "margin_buckets", "flips"]
RelationshipTable = Literal["summary", "matrix"]
RecalledStatus = Literal["Did Not Vote", "Do Not Remember"]
RankMetric = Literal["support_share", "net_score", "positive_share", "negative_share"]
# Demographic rankings are always bounded: top_k 1..TOP_K_MAX within each partition.
TOP_K_MAX = 5

# ac_num and pc_num are seat-level; district is treated as seat-level until verified
# (spec section 13.1). party_zone and zone are zone-only.
SEAT_DIMENSIONS = frozenset({"ac_num", "pc_num", "district"})
# Seat type/score from a past election: not offered by Configure yet (owner, 2026-11-19).
SEGMENT_FIELDS = frozenset({"ac_type", "ac_score", "pc_type", "pc_score"})
PARTY_ROW_FAMILIES = frozenset({"distribution", "gender_differential"})
# Families whose cards may read surveys of several levels. Seat ranking and benchmark are seat-based and
# need one seat level; demographic ranking compares one collection level.
MIXED_LEVEL_FAMILIES = frozenset({"distribution", "opinion", "gender_differential", "relationship"})
OPINION_MEASURES = ("net_score", "positive_share", "negative_share")
PARTY_MEASURES = ("support_share",)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _fail(path: str, message: str) -> NoReturn:
    """Raise a validation error that names the CardConfig path it is about ("" = the whole card).

    Configure shows the message next to that field; the text after the prefix is the rule itself."""
    raise ValueError(f"@{path}: {message}")


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


class RankConfig(_Strict):
    """What a ranking card ranks. `level` is ac|pc for seats, a profiling field otherwise."""

    metric: RankMetric
    party_id: str | None = None
    level: str
    partition_by: list[str] = Field(default_factory=list)
    filters: list[FilterSpec] = Field(default_factory=list)  # seat attributes (seat ranking)
    top_k: int | None = Field(default=None, ge=1)


class BenchmarkConfig(_Strict):
    """The engine part of a benchmark card: everything here changes the engine run."""

    focal_party: str | None = None
    grouping_sets: list[list[str]] = Field(default_factory=lambda: [[]])
    # What the survey is compared with; None = the card's own default (the comparison round).
    reference: BenchmarkReference | None = None
    # The party question the comparison survey is read with; None = the card's own question. Only for a
    # survey reference. With the same survey on both sides it compares two questions within one round.
    reference_scenario: str | None = None
    # The parties shown; None = every alliance major. Unlisted majors still compete and win seats.
    contenders: list[str] | None = None

    @model_validator(mode="after")
    def _check(self) -> "BenchmarkConfig":
        sets = [tuple(gs) for gs in self.grouping_sets]
        if not sets or len(set(sets)) != len(sets) or any(len(set(gs)) != len(gs) for gs in sets):
            _fail("benchmark.grouping_sets", "grouping_sets must be nonempty with no duplicate set or "
                  "attribute; use [[]] for the overall grain (duplicate grouping)")
        if self.contenders is not None:
            if not self.contenders or len(set(self.contenders)) != len(self.contenders):
                _fail("benchmark.contenders", "contenders must be nonempty and unique")
            if self.focal_party is not None and self.focal_party not in self.contenders:
                _fail("benchmark.contenders", "the focal party must be among the contenders")
        return self


class BenchmarkViewConfig(_Strict):
    """The display part of a benchmark card: never part of the engine config or its fingerprint."""

    table: BenchmarkTable | None = None


class JointWeight(_Strict):
    """Which weight pairs the two answers of one respondent: the base weight, or a scenario's own."""

    source: Literal["base", "scenario"] = "base"
    scenario: str | None = None


class RelationshipConfig(_Strict):
    """The engine part of a relationship card: everything here changes the engine run.

    The joint weight is always the base weight (spec section 2.2); the focal party must be an
    alliance identity, checked at compile time against the alliance table.
    """

    origin: str
    destination: str
    focal_party: str | None = None
    include_recalled: dict[Literal["origin", "destination"], list[RecalledStatus]] = Field(default_factory=dict)
    joint_weight: JointWeight = Field(default_factory=JointWeight)


class RelationshipViewConfig(_Strict):
    """The display part of a relationship card: never part of the engine config or its fingerprint."""

    table: RelationshipTable | None = None


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


def party_scenarios_of(scenario_ids) -> list[str]:
    """The party-domain scenarios among a dataset's recorded ones that the engine accepts without
    an extra weight binding, sorted. Ids the scenario catalogue does not know are skipped, never
    guessed. A party scenario with no embedded weights (other than a recalled vote, which uses base
    weights) needs an owner-approved external weight binding, so it is left out."""
    catalogue = _scenario_catalogue()
    found = []
    for scenario in scenario_ids:
        try:
            if scenario_kind(scenario) != "party":
                continue
        except ValueError:
            continue
        spec = catalogue[scenario]
        if spec.weight_keys or spec.role == "recalled_vote":
            found.append(scenario)
    return sorted(found)


def comparison_kind(target_kind: str, reference_kind: str) -> Literal["difference", "shakti"]:
    if target_kind == reference_kind:
        return "difference"
    if target_kind == "party" and reference_kind == "opinion":
        return "shakti"
    _fail("comparison.reference", "an opinion target cannot be compared with a party reference")


class CardConfig(_Strict):
    id: str
    family: Family
    section: str = "cards"
    title: str
    scenarios: list[str] = Field(default_factory=list)
    # Distribution only: every party scenario the anchor round's dataset records (spec 5.3).
    all_party_scenarios: bool = False
    cuts: list[list[str]] = Field(default_factory=lambda: [[]])
    filters: list[FilterSpec] = Field(default_factory=list)
    comparison: ComparisonConfig = Field(default_factory=ComparisonConfig)
    caste_clubbing: bool = False
    requires: Requirements = Field(default_factory=Requirements)
    rank: RankConfig | None = None
    benchmark: BenchmarkConfig | None = None
    relationship: RelationshipConfig | None = None
    view: BenchmarkViewConfig | RelationshipViewConfig | None = None
    # Trend / pipe rounds this card reads: the last N up to the anchor; None = all the context's.
    pipe_rounds: int | None = Field(default=None, ge=1)
    # Party rows to keep showing (distribution and gender differential); empty = all.
    display_parties: list[str] = Field(default_factory=list)
    # This card's own survey instead of the context's anchor / comparison round (base names; None = the context's).
    anchor_round: str | None = None
    compare_round: str | None = None
    # Party vote share and opinion cards, standalone: the surveys read (one = that survey, several = side by side).
    surveys: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _view_class_by_family(cls, data):
        """`view` means a different thing per family; pick its class before validation."""
        if isinstance(data, dict) and isinstance(data.get("view"), dict):
            view_class = RelationshipViewConfig if data.get("family") in RELATIONSHIP_FAMILIES else BenchmarkViewConfig
            return {**data, "view": view_class.model_validate(data["view"])}
        return data

    @model_validator(mode="after")
    def _validate(self) -> "CardConfig":
        comparison = self.comparison
        if self.surveys:
            self._check_surveys(comparison)
        if (self.compare_round is not None and comparison.mode != "compare"
                and self.family not in BENCHMARK_FAMILIES | RANKING_FAMILIES):
            _fail("compare_round", "compare_round applies to compare mode only")
        if self.display_parties and self.family not in PARTY_ROW_FAMILIES:
            _fail("display_parties", "display_parties apply to distribution and gender differential cards")
        if self.all_party_scenarios:
            self._check_all_party_scenarios(comparison)
        if self.family in RELATIONSHIP_FAMILIES:
            self._check_relationship(comparison)
            return self
        if self.relationship is not None:
            _fail("relationship", "relationship applies to relationship cards only")
        if self.family in BENCHMARK_FAMILIES:
            self._check_benchmark(comparison)
            return self
        if self.benchmark is not None or self.view is not None:
            _fail("benchmark", "benchmark and view apply to benchmark families only")
        if self.family in RANKING_FAMILIES:
            self._check_ranking(comparison)
            return self
        if self.rank is not None:
            _fail("rank", "rank applies to ranking families only")
        self._check_cuts()
        if self.all_party_scenarios:
            return self
        self._check_endpoints_and_scenarios(comparison)
        self._check_family(comparison)
        self._check_delta_measures(comparison)
        fields = [f.field for f in self.filters]
        if len(set(fields)) != len(fields):
            _fail("filters", "one filter per field")
        if self.caste_clubbing and not any("caste" in cut for cut in self.cuts):
            _fail("caste_clubbing", "caste_clubbing needs caste in a cut")
        return self

    def _check_all_party_scenarios(self, comparison: ComparisonConfig) -> None:
        if (self.family != "distribution" or self.scenarios or self.cuts != [[]] or self.filters
                or self.caste_clubbing or comparison != ComparisonConfig()):
            _fail("all_party_scenarios", "all_party_scenarios is for a standalone distribution card with no "
                             "scenarios listed, cuts [[]], no filters and no caste clubbing")

    def _check_relationship(self, comparison: ComparisonConfig) -> None:
        rel = self.relationship
        if rel is None:
            _fail("relationship", "a relationship card needs a relationship block")
        if (self.scenarios or self.rank is not None or self.benchmark is not None or self.caste_clubbing
                or self.filters or comparison != ComparisonConfig()):
            _fail("", "a relationship card takes no scenarios, comparison, caste_clubbing, filters, "
                             "rank or benchmark; its two scenarios are in the relationship block")
        if self.view is not None and not isinstance(self.view, RelationshipViewConfig):
            _fail("view", "a relationship card's view must be a relationship view (summary or matrix)")
        if rel.origin == rel.destination:
            _fail("relationship.destination", "relationship origin and destination must differ")
        for scenario in (rel.origin, rel.destination):
            if scenario_kind(scenario) != "party":
                _fail("relationship.origin", f"relationship scenario {scenario!r} must be a party scenario")
        catalogue = _scenario_catalogue()
        for endpoint, statuses in rel.include_recalled.items():
            if statuses and catalogue[getattr(rel, endpoint)].role != "recalled_vote":
                _fail("relationship.include_recalled", f"include_recalled applies to a recalled endpoint; "
                                 f"{getattr(rel, endpoint)!r} is not recalled")
        self._check_joint_weight(rel.joint_weight)
        self._check_cuts()

    def _check_joint_weight(self, weight: JointWeight) -> None:
        path = "relationship.joint_weight.scenario"
        if weight.source == "base":
            if weight.scenario is not None:
                _fail(path, "a base joint weight takes no scenario")
            return
        if weight.scenario is None:
            _fail(path, "a scenario joint weight needs a scenario")
        if scenario_kind(weight.scenario) != "party" or not _scenario_catalogue()[weight.scenario].weight_keys:
            _fail(path, f"scenario {weight.scenario!r} has no weights of its own to use as the joint weight")

    def _check_benchmark(self, comparison: ComparisonConfig) -> None:
        if self.benchmark is None:
            _fail("benchmark", "a benchmark card needs a benchmark block")
        if self.rank is not None or self.caste_clubbing or comparison.delta_measures or self.filters:
            _fail("", "a benchmark card takes no rank, caste_clubbing, delta_measures or filters")
        if comparison.mode != "standalone" or comparison.target or comparison.reference:
            _fail("comparison", "benchmark cards are standalone: the reference is chosen on the card")
        if len(self.scenarios) != 1:
            _fail("scenarios", "a benchmark card uses exactly one scenario")
        if scenario_kind(self.scenarios[0]) != "party":
            _fail("scenarios", "a benchmark card needs a party scenario")
        question = self.benchmark.reference_scenario
        if question is not None:
            if scenario_kind(question) != "party":
                _fail("benchmark.reference_scenario", "the compared question must be a party question")
            reference = self.benchmark.reference
            if reference is not None and reference.kind != "compare":
                _fail("benchmark.reference_scenario", "a compared question applies to a survey reference only")

    def _check_ranking(self, comparison: ComparisonConfig) -> None:
        rank = self.rank
        if rank is None:
            _fail("rank", "a ranking card needs a rank block")
        if self.caste_clubbing:
            _fail("caste_clubbing", "caste_clubbing does not apply to ranking cards")
        if comparison.delta_measures:
            _fail("comparison.delta_measures", "delta_measures do not apply to ranking cards; the metric is ranked")
        self._check_endpoints_and_scenarios(comparison)
        primary = comparison.target.scenario if comparison.mode == "compare" else None
        if comparison.mode == "compare":
            comparison_kind(scenario_kind(comparison.target.scenario),
                            scenario_kind(comparison.reference.scenario))
        elif len(self.scenarios) != 1:
            _fail("scenarios", "a ranking card ranks exactly one scenario")
        else:
            primary = self.scenarios[0]
        wanted = "party" if rank.metric == "support_share" else "opinion"
        if scenario_kind(primary) != wanted:
            _fail("rank.metric", f"metric {rank.metric!r} does not match the {primary!r} scenario")
        if (rank.party_id is None) == (wanted == "party"):
            _fail("rank.party_id", "party_id is required for party metrics and forbidden for opinion metrics")
        fields = [f.field for f in rank.filters + self.filters]
        if len(set(fields)) != len(fields):
            _fail("filters", "one filter per field")
        if self.family == "seat_ranking":
            if rank.level not in ("ac", "pc"):
                _fail("rank.level", "seat ranking level must be ac or pc")
            if self.filters:
                _fail("filters", "seat ranking takes no respondent filters; use rank.filters for seat attributes")
            return
        if rank.filters:
            _fail("rank.filters", "demographic ranking takes respondent filters on the card, "
                             "not in rank.filters")
        if rank.level in rank.partition_by:
            _fail("rank.partition_by", "ranking level and partition fields must be distinct")
        if rank.top_k is None or rank.top_k > TOP_K_MAX:
            _fail("rank.top_k", f"demographic ranking needs top_k from 1 to {TOP_K_MAX}")

    def _check_cuts(self) -> None:
        if not self.cuts:
            _fail("cuts", "a card needs at least one cut; use [[]] for the overall grain")
        grains = [frozenset(cut) for cut in self.cuts]
        if len(set(grains)) != len(grains):
            _fail("cuts", "duplicate cut: two cuts describe the same grain")
        if self.family == "gender_differential" and any("gender" in cut for cut in self.cuts):
            _fail("cuts", "gender is not allowed in cuts for gender differential "
                             "(the engine removes it)")

    def _check_endpoints_and_scenarios(self, comparison: ComparisonConfig) -> None:
        if comparison.mode == "compare":
            if comparison.target is None or comparison.reference is None:
                _fail("comparison", "compare mode needs target and reference endpoints")
            if comparison.target == comparison.reference:
                _fail("comparison.reference", "compare target and reference are the same endpoint")
            self.scenarios = list(dict.fromkeys(
                [comparison.target.scenario, comparison.reference.scenario]))
            return
        if comparison.target is not None or comparison.reference is not None:
            _fail("comparison", f"{comparison.mode} mode takes no target or reference")
        if comparison.mode == "trend" and len(self.scenarios) != 1:
            _fail("scenarios", "trend mode needs exactly one scenario")
        if not self.scenarios:
            _fail("scenarios", "a card needs at least one scenario")

    def _check_family(self, comparison: ComparisonConfig) -> None:
        if self.family == "gender_differential" and comparison.mode == "compare":
            _fail("comparison.mode", "gender differential has no compare mode")
        wanted = "opinion" if self.family == "opinion" else "party"
        primary = ([comparison.target.scenario] if comparison.mode == "compare"
                   else self.scenarios)
        for scenario in primary:
            kind = scenario_kind(scenario)
            if kind != wanted:
                _fail("scenarios", f"scenario kind {kind!r} ({scenario}) is not valid "
                                 f"for the {self.family} family")

    def _check_surveys(self, comparison: ComparisonConfig) -> None:
        trend = comparison.mode == "trend"
        if trend:
            if self.family not in ("distribution", "opinion", "gender_differential"):
                _fail("surveys", "a custom set of surveys applies to party vote share, opinion and gender gap trends")
            if len(self.surveys) < 2:
                _fail("surveys", "a trend follows at least two surveys")
            if self.pipe_rounds is not None:
                _fail("surveys", "choose either the surveys or the last N rounds, not both")
        elif self.family not in ("distribution", "opinion") or comparison.mode != "standalone":
            _fail("surveys", "surveys apply to party vote share and opinion cards in standalone or trend mode")
        if len(set(self.surveys)) != len(self.surveys):
            _fail("surveys", "choose each survey once")
        if self.anchor_round is not None:
            _fail("surveys", "choose either one survey or several, not both")
        if len(self.surveys) > 1 and self.all_party_scenarios:
            _fail("surveys", "every-party-question cards read one survey; choose one or list the questions")
        if len(self.surveys) > 1 and len(self.scenarios) > 1 and any(cut for cut in self.cuts):
            _fail("cuts", "several questions across several surveys show overall only")

    def _check_delta_measures(self, comparison: ComparisonConfig) -> None:
        if comparison.mode != "compare":
            if comparison.delta_measures:
                _fail("comparison.delta_measures", "delta_measures apply to compare mode only")
            return
        kind = comparison_kind(scenario_kind(comparison.target.scenario),
                               scenario_kind(comparison.reference.scenario))
        if kind == "shakti":
            comparison.delta_measures = []
            return
        allowed = OPINION_MEASURES if self.family == "opinion" else PARTY_MEASURES
        if len(set(comparison.delta_measures)) != len(comparison.delta_measures):
            _fail("comparison.delta_measures", "duplicate delta_measures")
        if not comparison.delta_measures:
            comparison.delta_measures = [allowed[0]]
        bad = [m for m in comparison.delta_measures if m not in allowed]
        if bad:
            _fail("comparison.delta_measures", f"delta measure {bad[0]!r} is not allowed for the "
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
