"""Compile the cohort creation run: the card's own seat ranking or benchmark plus a selection.

The engine turns the source (the card's own request, so its comparisons and filters stay) into a
seat list and runs a fixed downstream cut: overall vote share in the anchor round for every party
scenario the survey dataset records for that round. Nothing is computed here.
"""
from __future__ import annotations

from dataclasses import replace
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from matbodh_dashboard.cards.compile import GRID, _by_base_name, compile_card
from matbodh_dashboard.cards.config import CardConfig, party_scenarios_of
from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.compiler.plan import EngineJob, RunPlan
from matbodh_dashboard.compiler.requests import build_request, view_config
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import MethodPreset

_RANKING_FIELDS = ("rank_max", "metric_min", "metric_max")
_BENCHMARK_FIELDS = ("endpoint", "status", "margin_min", "margin_max", "flip")


class SelectionPredicate(BaseModel):
    """What the user asks of the card's result: ranking fields or benchmark fields, never both."""

    model_config = ConfigDict(extra="forbid")

    rank_max: int | None = Field(default=None, ge=1)
    metric_min: float | None = None
    metric_max: float | None = None
    endpoint: Literal["target", "reference"] | None = None
    status: Literal["winning", "losing"] | None = None
    margin_min: float | None = None
    margin_max: float | None = None
    flip: Literal["gain", "loss", "winning_both", "losing_both"] | None = None
    lower_inclusive: bool = True
    upper_inclusive: bool = False

    @model_validator(mode="after")
    def _check(self) -> SelectionPredicate:
        ranking = [f for f in _RANKING_FIELDS if getattr(self, f) is not None]
        benchmark = [f for f in _BENCHMARK_FIELDS if getattr(self, f) is not None]
        if not ranking and not benchmark:
            raise ValueError("a selection needs at least one predicate")
        if ranking and benchmark:
            raise ValueError("ranking and benchmark predicates cannot be mixed")
        for low, high in ((self.metric_min, self.metric_max), (self.margin_min, self.margin_max)):
            if low is not None and high is not None and low >= high:
                raise ValueError("a lower limit must be below its upper limit")
        return self

    @property
    def kind(self) -> Literal["ranking", "benchmark"]:
        return "ranking" if any(getattr(self, f) is not None for f in _RANKING_FIELDS) else "benchmark"


def _source_job(plan: RunPlan) -> EngineJob:
    if len(plan.jobs) == 1:
        return plan.jobs[0]
    anchor = _by_base_name(list(plan.rounds), plan.anchor)
    # A trend ranking has one job per round; the anchor round's job is the card's own result.
    return next((j for j in plan.jobs if j.config["ranking"]["target"][0] == anchor.obs_id), plan.jobs[0])


def compile_cohort_selection(config: CardConfig, ctx: StateContext, catalogue: Catalogue,
                             preset: MethodPreset, predicate: SelectionPredicate, *,
                             reference=None, parties=None, elections=None) -> RunPlan:
    base = compile_card(config, ctx, catalogue, preset, reference=reference, parties=parties,
                        elections=elections)
    if base.unavailable or not base.jobs:
        return base

    def refuse(reason: str) -> RunPlan:
        return replace(base, jobs=(), unavailable=(*base.unavailable, (GRID, reason)))

    if config.family == "demographic_ranking":
        return refuse("A demographic ranking cannot supply a seat set; use a seat ranking or benchmark card")
    if config.family not in ("seat_ranking", "seat_benchmark"):
        return refuse("Only seat ranking and seat benchmark cards can make a cohort")

    job = _source_job(base)
    key = "ranking" if config.family == "seat_ranking" else "benchmark"
    if predicate.kind != key:
        return refuse("This card is a seat ranking: use rank limits" if key == "ranking"
                      else "This card is a seat benchmark: use margin, status or flip")
    if key == "benchmark":
        source = job.config["benchmark"]
        if source["focal_party"] is None:
            return refuse("A benchmark cohort needs the card to have a focal party")
        if (predicate.flip is not None or predicate.endpoint == "reference") and source["reference"] is None:
            return refuse("This predicate needs a reference endpoint; choose a reference for the card")

    anchor_round = _by_base_name(list(base.rounds), base.anchor)
    scenarios = party_scenarios_of(anchor_round.dataset.scenarios)
    if not scenarios:
        return refuse(f"No party scenario is recorded for {base.anchor}")
    downstream = build_request(state=ctx.state, rounds=[anchor_round], scenarios=scenarios,
                               grouping_sets=[[]], preset=preset)
    selection = {"id": "cohort", **predicate.model_dump(exclude_none=True),
                 "source_request": job.config["request"]}
    selected = view_config(downstream, preset, **{key: job.config[key]}, selection=selection)
    return replace(base, jobs=(EngineJob("selection", "selection", GRID, selected),))
