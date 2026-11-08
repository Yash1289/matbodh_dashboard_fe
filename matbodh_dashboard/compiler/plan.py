"""Turn one dashboard card plus context into engine jobs.

Per-round availability (spec §12 step 2): the engine rejects a whole request
when any observation lacks a requested scenario or a required field
(validation.py). Each job is therefore compiled only over the rounds that
asked its question; the other rounds are reported in ``RunPlan.not_asked`` and
become None + ``not_asked`` cells. Observation ids stay global (o1..oN over
all selected rounds) so cells from different jobs line up.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from functools import lru_cache
from typing import Literal

from matbodh_dashboard.capability import capabilities, resolve_anchor, template_blockers
from matbodh_dashboard.catalogue.store import Catalogue, DatasetVersion
from matbodh_dashboard.compiler.coverage import choose_coverage
from matbodh_dashboard.compiler.requests import build_request, comparison, view_config
from matbodh_dashboard.compiler.rounds import ResolvedRound, resolve_rounds
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import MethodPreset
from matbodh_dashboard.templates import CardTemplate

VOTE_SCENARIO = "vs_voting_intention"
SEATS_UNAVAILABLE = "Seat views need an AC or PC level survey"
# The ungrouped twin of the vote job. The vote job applies other_grouping, so
# the engine folds every party outside the keep list into Other; benchmark
# summaries cover only listed contenders. Contenders, and the vote share of a
# seat winner outside the keep list, therefore come from this job.
PARTIES_JOB = "parties"
GENDER_PART = "gender_gap"
SEAT_LEVELS = ("ac", "pc")


@dataclass(frozen=True)
class EngineJob:
    key: str
    kind: Literal["analysis", "benchmark"]
    part: str  # vote | parties | seats_ac | seats_pc | opinion | zone
    config: dict
    contenders_from: str | None = None


@dataclass(frozen=True)
class RunPlan:
    card_id: str
    state: str
    rounds: tuple[ResolvedRound, ...]
    anchor: str
    compare: str | None
    jobs: tuple[EngineJob, ...]
    unavailable: tuple[tuple[str, str], ...]
    # (part, base names of selected rounds that did not ask its question)
    not_asked: tuple[tuple[str, tuple[str, ...]], ...] = ()


@lru_cache(maxsize=1)
def _engine_master_fields() -> frozenset[str]:
    """Seat attributes the engine resolves from masters, not from responses.

    The engine's MetadataSession adds these to every observation's available
    fields (metadata_runtime.py), so metadata never lists them per dataset.
    """
    from matbodh_dash.catalog import default_fields

    return frozenset(k for k, f in default_fields().items() if f.source == "master")


def field_available(dataset: DatasetVersion, field: str) -> bool:
    return field in dataset.fields or field in _engine_master_fields()


def _by_base_name(rounds: Sequence[ResolvedRound], base_name: str) -> ResolvedRound:
    for r in rounds:
        if r.identity.base_name == base_name:
            return r
    raise ValueError(f"round {base_name!r} is not among the resolved rounds")


def _names(rounds: Sequence[ResolvedRound]) -> tuple[str, ...]:
    return tuple(r.identity.base_name for r in rounds)


def _asked(rounds: Sequence[ResolvedRound], scenario: str) -> list[ResolvedRound]:
    return [r for r in rounds if scenario in r.dataset.scenarios]


def _not_asked_reason(scenario: str, rounds: Sequence[ResolvedRound]) -> str:
    return f"No selected round asked {scenario!r} (checked: {', '.join(_names(rounds))})"


def _endpoint(round_: ResolvedRound) -> dict:
    return {
        "source": "survey",
        "id": round_.obs_id,
        "observation": round_.obs_id,
        "scenario": VOTE_SCENARIO,
    }


def _benchmark_job(
    part: str,
    level: str,
    target: ResolvedRound,
    reference: ResolvedRound | None,
    ctx: StateContext,
    preset: MethodPreset,
    seat_ids: Sequence[int] = (),
) -> EngineJob:
    used = [target] if reference is None else [reference, target]
    used.sort(key=lambda r: r.obs_id)
    key = f"{part}_{target.obs_id}" + (f"_{reference.obs_id}" if reference else "")
    request = build_request(
        state=ctx.state,
        rounds=used,
        scenarios=[VOTE_SCENARIO],
        grouping_sets=[[]],
        preset=preset,
        other_grouping=False,
        coverage_mode=choose_coverage(used, uses_seat_ids=bool(seat_ids), geographic=False,
                                      version_mode=ctx.version_mode),
    )
    benchmark = {
        "id": key,
        "seat_level": level,
        "target": _endpoint(target),
        "reference": _endpoint(reference) if reference else None,
        "contenders": [],
        "focal_party": None,
        "grouping_sets": [[]],
        "filters": [],
        "seat_ids": list(seat_ids),
        "competition_excluded": list(preset.competition_excluded),
    }
    return EngineJob(
        key=key,
        kind="benchmark",
        part=part,
        config=view_config(request, preset, benchmark=benchmark),
        contenders_from=PARTIES_JOB,
    )


class _Planner:
    """Collects jobs, unavailable parts and not-asked rounds for one card."""

    def __init__(self, template: CardTemplate, ctx: StateContext,
                 rounds: list[ResolvedRound], anchor: ResolvedRound,
                 compare: ResolvedRound | None, preset: MethodPreset) -> None:
        self.template, self.ctx, self.rounds = template, ctx, rounds
        self.anchor, self.compare, self.preset = anchor, compare, preset
        self.jobs: list[EngineJob] = []
        self.unavailable: list[tuple[str, str]] = []
        self.not_asked: list[tuple[str, tuple[str, ...]]] = []

    def _comparisons(self, asked: Sequence[ResolvedRound], scenarios: Sequence[str],
                     measure: str) -> list[dict]:
        """A comparison only when both anchor and compare asked the question."""
        if self.compare is None or self.anchor not in asked or self.compare not in asked:
            return []
        return [comparison(self.anchor, self.compare, s, measure) for s in scenarios]

    def _note_not_asked(self, part: str, asked: Sequence[ResolvedRound]) -> None:
        missing = [r for r in self.rounds if r not in asked]
        if missing:
            self.not_asked.append((part, _names(missing)))

    def _missing_field(self, asked: Sequence[ResolvedRound], field: str) -> list[ResolvedRound]:
        return [r for r in asked if not field_available(r.dataset, field)]

    def _matched_seat_ids(self, level: str) -> list[int] | None:
        """Matched mode: seats every selected round's Normal dataset surveyed.

        Dataset seat ids are native to the collection level, so they restrict
        benchmarks at that level only. Returns [] when no restriction applies
        and None when the rounds share no seat (the part is then unavailable;
        an empty engine seat_ids list would mean every seat).
        """
        if self.ctx.version_mode != "matched" or level != self.ctx.level:
            return []
        common = frozenset.intersection(*(r.dataset.seat_ids for r in self.rounds))
        return sorted(common) or None

    def card_parts(self) -> list[str]:
        if self.template.operation == "scoreboard":
            return ["vote", GENDER_PART, *[f"seats_{level}" for level in SEAT_LEVELS]]
        if self.template.operation == "opinion":
            return list(self.template.questions)
        return ["zone"]

    def blocked(self) -> bool:
        """Template requirements (min_level, geographic slices) against the level."""
        reasons = template_blockers(self.template.requires.min_level,
                                    self.template.slices, self.ctx.level)
        if reasons:
            reason = "; ".join(reasons)
            self.unavailable += [(part, reason) for part in self.card_parts()]
        return bool(reasons)

    # -- operations --------------------------------------------------------

    def scoreboard(self) -> None:
        ctx, preset = self.ctx, self.preset
        allowed = capabilities(ctx.level).seat_levels
        seat_parts = [f"seats_{level}" for level in SEAT_LEVELS if level in allowed]
        if not allowed:  # zone/state surveys have no seat views at all
            self.unavailable += [(f"seats_{level}", SEATS_UNAVAILABLE) for level in SEAT_LEVELS]
        asked = _asked(self.rounds, VOTE_SCENARIO)
        if not asked:
            reason = _not_asked_reason(VOTE_SCENARIO, self.rounds)
            self.unavailable += [(p, reason) for p in ("vote", GENDER_PART, *seat_parts)]
            return

        no_gender = self._missing_field(asked, preset.gender.field)
        gender = not no_gender
        if no_gender:
            self.unavailable.append((GENDER_PART, (
                f"Gender gap needs the {preset.gender.field!r} field in every included "
                f"round; missing in: {', '.join(_names(no_gender))}")))
        for part in ("vote", *([GENDER_PART] if gender else []), *seat_parts):
            self._note_not_asked(part, asked)

        coverage = choose_coverage(asked, uses_seat_ids=False, geographic=False,
                                   version_mode=ctx.version_mode)
        request = build_request(
            state=ctx.state, rounds=asked, scenarios=[VOTE_SCENARIO], grouping_sets=[[]],
            preset=preset, comparisons=self._comparisons(asked, [VOTE_SCENARIO],
                                                         "support_share"),
            gender=gender, coverage_mode=coverage,
        )
        self.jobs.append(EngineJob("vote", "analysis", "vote", view_config(request, preset)))
        if not allowed:
            return
        ungrouped = build_request(
            state=ctx.state, rounds=asked, scenarios=[VOTE_SCENARIO], grouping_sets=[[]],
            preset=preset, coverage_mode=coverage, other_grouping=False,
        )
        self.jobs.append(EngineJob(PARTIES_JOB, "analysis", PARTIES_JOB,
                                   view_config(ungrouped, preset)))
        paired = self.compare is not None and self.anchor in asked and self.compare in asked
        for level in SEAT_LEVELS:
            if level not in allowed:
                continue
            part = f"seats_{level}"
            seat_ids = self._matched_seat_ids(level)
            if seat_ids is None:
                self.unavailable.append((part, (
                    "Matched seats: the selected rounds share no surveyed seat")))
                continue
            singles = list(asked)
            if paired:
                self.jobs.append(_benchmark_job(part, level, self.anchor, self.compare,
                                                ctx, preset, seat_ids))
                singles = [r for r in asked if r is not self.anchor and r is not self.compare]
            elif self.anchor in asked:  # anchor first, as with a paired benchmark
                singles = [self.anchor] + [r for r in asked if r is not self.anchor]
            for other in singles:
                self.jobs.append(_benchmark_job(part, level, other, None, ctx, preset,
                                                seat_ids))

    def by_question(self, part: str, measure: str, *, per_question_part: bool,
                    geographic: bool, grouping_sets: list[list[str]]) -> None:
        """One job per distinct set of rounds that asked the template's questions."""
        groups: dict[tuple[str, ...], tuple[list[ResolvedRound], list[str]]] = {}
        for question in self.template.questions:
            label = question if per_question_part else part
            asked = _asked(self.rounds, question)
            if not asked:
                self.unavailable.append((label, _not_asked_reason(question, self.rounds)))
                continue
            self._note_not_asked(label, asked)
            key = tuple(r.obs_id for r in asked)
            groups.setdefault(key, (asked, []))[1].append(question)

        for index, (asked, questions) in enumerate(groups.values(), start=1):
            key = part if len(groups) == 1 else f"{part}_{index}"
            coverage = choose_coverage(asked, uses_seat_ids=False, geographic=geographic,
                                       version_mode=self.ctx.version_mode)
            request = build_request(
                state=self.ctx.state, rounds=asked, scenarios=questions,
                grouping_sets=grouping_sets, preset=self.preset,
                comparisons=self._comparisons(asked, questions, measure),
                coverage_mode=coverage,
            )
            self.jobs.append(EngineJob(key, "analysis", part,
                                       view_config(request, self.preset)))

    def distribution(self) -> None:
        part = "zone"
        for slice_ in self.template.slices:
            missing = [r for r in self.rounds
                       if any(q in r.dataset.scenarios for q in self.template.questions)
                       and not field_available(r.dataset, slice_)]
            if missing:
                self.unavailable.append((part, (
                    f"Slice {slice_!r} needs that field in every included round; "
                    f"missing in: {', '.join(_names(missing))}")))
                return
        self.by_question(part, "support_share", per_question_part=False, geographic=True,
                         grouping_sets=[[], *[[s] for s in self.template.slices]])


def plan_card(
    template: CardTemplate,
    ctx: StateContext,
    catalogue: Catalogue,
    preset: MethodPreset,
) -> RunPlan:
    rounds = resolve_rounds(ctx, catalogue)
    anchor_name = resolve_anchor(ctx, catalogue)
    anchor = _by_base_name(rounds, anchor_name)
    compare = _by_base_name(rounds, ctx.compare_round) if ctx.compare_round else None
    planner = _Planner(template, ctx, rounds, anchor, compare, preset)

    if planner.blocked():
        pass  # every part is unavailable with the template's reason
    elif template.operation == "scoreboard":
        planner.scoreboard()
    elif template.operation == "opinion":
        planner.by_question("opinion", "net_score", per_question_part=True,
                            geographic=False, grouping_sets=[[]])
    else:  # distribution (by zone)
        planner.distribution()

    return RunPlan(
        card_id=template.id,
        state=ctx.state,
        rounds=tuple(rounds),
        anchor=anchor_name,
        compare=ctx.compare_round,
        jobs=tuple(planner.jobs),
        unavailable=tuple(planner.unavailable),
        not_asked=tuple(planner.not_asked),
    )


def bind_contenders(
    job: EngineJob, parties: Sequence[str], preset: MethodPreset
) -> EngineJob:
    """Fill a benchmark job's contenders from the ungrouped parties job's list,
    minus competition-excluded identities and the Other label."""
    if job.kind != "benchmark":
        raise ValueError("only benchmark jobs take contenders")
    excluded = set(preset.competition_excluded) | {preset.other_label}
    contenders = sorted(p for p in set(parties) if p not in excluded)
    benchmark = {**job.config["benchmark"], "contenders": contenders}
    return replace(job, config={**job.config, "benchmark": benchmark})
