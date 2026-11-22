"""Card runs: compile a card, run its engine job and translate the result.

Jobs are fingerprinted (config + metadata revision + engine version + alliance
epoch), served from the cache when possible and submitted once per fingerprint.
Assembly only reshapes engine output: every number is copied, never computed.

Run handles live in this process (the API process); results and job state are
shared through Redis.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from collections import OrderedDict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal

from matbodh_dashboard.cards.configure.values import compile_values, translate_values
from matbodh_dashboard.cards.cohort.compile import SelectionPredicate, compile_cohort_selection
from matbodh_dashboard.cards.cohort.translate import translate_selection
from matbodh_dashboard.cards.compile import compile_card
from matbodh_dashboard.cards.benchmark.parties import ElectionOption, MajorPartyProvider
from matbodh_dashboard.cards.benchmark.compile import endpoint_parties_of
from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
from matbodh_dashboard.cards.benchmark.translate import translate_benchmark
from matbodh_dashboard.cards.relationship.compile import relationship_majors
from matbodh_dashboard.cards.relationship.translate import translate_relationship
from matbodh_dashboard.cards.config import (
    BENCHMARK_FAMILIES, RANKING_FAMILIES, RELATIONSHIP_FAMILIES, CardConfig,
)
from matbodh_dashboard.cards.families import get_family
from matbodh_dashboard.cards.ranking.labels import SeatLabelProvider
from matbodh_dashboard.cards.ranking.translate import translate_ranked
from matbodh_dashboard.cards.translate import TranslateContext, merge_results, only_observation, translate_grid
from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.compiler.fingerprint import fingerprint
from matbodh_dashboard.compiler.plan import EngineJob, RunPlan, rounds_block
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import MethodPreset
from matbodh_dashboard.registry import RuleSet
from matbodh_dashboard.runner.cache import ResultCache
from matbodh_dashboard.runner.engine import client_message
from matbodh_dashboard.runner.queue import JobQueue

log = logging.getLogger(__name__)

RunState = Literal["running", "done", "partial", "failed"]
MAX_RUNS = 1000  # run handles kept in memory; the oldest are forgotten first

_ENGINE_ARRAYS = ("rows", "scores", "gender_differentials", "summaries", "comparisons")


@dataclass(frozen=True)
class CardRunStatus:
    state: RunState
    done: int  # finished jobs (succeeded or failed)
    total: int
    result: dict | None
    errors: dict[str, dict]


@dataclass
class _Job:
    job: EngineJob
    fp: str | None = None
    status: Literal["waiting", "pending", "done", "failed"] = "waiting"
    result: dict | None = None
    error: dict | None = None
    cache_hit: bool = False


@dataclass
class _Run:
    card_id: str
    card: CardConfig
    plan: RunPlan
    revision: int
    epoch: int
    jobs: dict[str, _Job] = field(default_factory=dict)
    # Benchmark only: the alliance-mapped identities per endpoint, fixed when the run starts.
    endpoint_parties: dict[str, frozenset[str]] | None = None
    # Relationship only: the alliance-mapped major parties, fixed when the run starts.
    majors: frozenset[str] | None = None
    # A cohort creation run: its job is a selection, not the card's own result.
    selection: bool = False
    # A filter-values run: its job is a distribution cut by one field (Configure).
    values: bool = False


class CohortUnavailable(ValueError):
    """The card cannot make a cohort; the message is shown to the client."""


class ValuesUnavailable(ValueError):
    """The values of a field cannot be listed here; the message is shown to the client."""


class CardRunService:
    def __init__(
        self,
        catalogue: Catalogue,
        preset: MethodPreset,
        cards: dict[str, CardConfig],
        rules: RuleSet,
        cache: ResultCache,
        queue: JobQueue,
        engine_version: str,
        seat_labels: SeatLabelProvider | None = None,
        major_parties: MajorPartyProvider | None = None,
        elections: Mapping[str, Sequence[ElectionOption]] | None = None,
    ) -> None:
        self.catalogue = catalogue
        self.preset = preset
        self.cards = cards
        self.rules = rules
        self.cache = cache
        self.queue = queue
        self.engine_version = engine_version
        self.seat_labels = seat_labels
        self.major_parties = major_parties
        self.elections: Mapping[str, Sequence[ElectionOption]] = elections or {}
        self._runs: OrderedDict[str, _Run] = OrderedDict()
        self._lock = threading.RLock()

    # -- public API -------------------------------------------------------

    def plan(self, card_id: str | CardConfig, ctx: StateContext,
             reference: BenchmarkReference | None = None) -> RunPlan:
        return compile_card(self._card(card_id), ctx, self.catalogue, self.preset,
                            reference=reference, parties=self.major_parties, elections=self.elections,
                            cohort=ctx.cohort)

    def start(self, card_id: str | CardConfig, ctx: StateContext,
              reference: BenchmarkReference | None = None) -> str:
        card = self._card(card_id)
        run_id = uuid.uuid4().hex
        with self._lock:
            # One snapshot: a concurrent refresh_metadata cannot mix an old plan
            # with a new revision or epoch.
            catalogue, epoch = self.catalogue, self.cache.alliance_epoch()
        # Compiling may read the alliance table (a MySQL connect can take seconds): not under the lock.
        plan = compile_card(card, ctx, catalogue, self.preset, reference=reference,
                            parties=self.major_parties, elections=self.elections,
                            cohort=ctx.cohort)
        run = _Run(card.id, card, plan, catalogue.revision, epoch)
        run.jobs = {j.key: _Job(j) for j in plan.jobs}
        if card.family in BENCHMARK_FAMILIES and plan.jobs:
            # Already looked up (and cached) by the compile above; keep the answer with the run.
            run.endpoint_parties = endpoint_parties_of(plan.jobs[0].config, plan.state, self.preset,
                                                       self.major_parties)
        if card.family in RELATIONSHIP_FAMILIES and plan.jobs:
            run.majors = relationship_majors(plan.state, self.preset, self.major_parties)
        with self._lock:
            self._runs[run_id] = run
            while len(self._runs) > MAX_RUNS:
                self._runs.popitem(last=False)
            self._advance(run)
        return run_id

    def start_selection(self, card_id: str | CardConfig, ctx: StateContext, predicate: SelectionPredicate,
                        reference: BenchmarkReference | None = None) -> str:
        """Run the card's own ranking or benchmark with a selection and return the seat list (nothing is stored)."""
        card = self._card(card_id)
        with self._lock:
            catalogue, epoch = self.catalogue, self.cache.alliance_epoch()
        plan = compile_cohort_selection(card, ctx, catalogue, self.preset, predicate, reference=reference,
                                        parties=self.major_parties, elections=self.elections)
        if not plan.jobs:
            raise CohortUnavailable("; ".join(reason for _, reason in plan.unavailable))
        run_id = uuid.uuid4().hex
        run = _Run(card.id, card, plan, catalogue.revision, epoch, selection=True)
        run.jobs = {j.key: _Job(j) for j in plan.jobs}
        with self._lock:
            self._runs[run_id] = run
            while len(self._runs) > MAX_RUNS:
                self._runs.popitem(last=False)
            self._advance(run)
        return run_id

    def start_values(self, field: str, scenario: str | None, ctx: StateContext,
                     pipe_rounds: int | None) -> str:
        """List the values of one respondent field for a filter (nothing is stored; the job is cached)."""
        with self._lock:
            catalogue, epoch = self.catalogue, self.cache.alliance_epoch()
        plan = compile_values(field, scenario, ctx, catalogue, self.preset, pipe_rounds)
        if not plan.jobs:
            raise ValuesUnavailable("; ".join(reason for _, reason in plan.unavailable))
        asked = plan.jobs[0].config["request"]["scenarios"]
        stand_in = CardConfig(id="values", family="distribution", title="values", scenarios=asked)
        run_id = uuid.uuid4().hex
        run = _Run(stand_in.id, stand_in, plan, catalogue.revision, epoch, values=True)
        run.jobs = {j.key: _Job(j) for j in plan.jobs}
        with self._lock:
            self._runs[run_id] = run
            while len(self._runs) > MAX_RUNS:
                self._runs.popitem(last=False)
            self._advance(run)
        return run_id

    def status(self, run_id: str) -> CardRunStatus:
        with self._lock:
            run = self._runs.get(run_id)
            if run is None:
                raise KeyError(f"unknown run {run_id!r}")
            self._advance(run)
            return self._status(run)

    def job_timings(self, run_id: str) -> list[dict]:
        """Per-job part, key, fingerprint, state and timings (seconds, None if unknown)."""
        with self._lock:
            run = self._runs.get(run_id)
            if run is None:
                raise KeyError(f"unknown run {run_id!r}")
            out = []
            for job in run.jobs.values():
                timing = {} if job.cache_hit or job.fp is None else self.cache.timing(job.fp)
                out.append({
                    "part": job.job.part, "key": job.job.key, "fingerprint": job.fp,
                    "state": job.status, "cache_hit": job.cache_hit,
                    "queue_wait_s": _span(timing, "submitted_at", "started_at"),
                    "engine_s": _span(timing, "started_at", "finished_at"),
                })
            return out

    def refresh_metadata(self, catalogue: Catalogue) -> int:
        """Replace the catalogue; bumping the epoch invalidates every cached result."""
        with self._lock:
            self.catalogue = catalogue
            return self.cache.bump_epoch()

    # -- job progress -----------------------------------------------------

    def resolve(self, card_id: str | None, card: CardConfig | None = None) -> CardConfig:
        """The card a request is about: the inline config, or the library card (KeyError if unknown)."""
        if (card_id is None) == (card is None):
            raise ValueError("give exactly one of card_id or card")
        return card if card is not None else self._card(card_id)

    def _card(self, card: str | CardConfig) -> CardConfig:
        """A library card by id; an inline config passes through unchanged."""
        if isinstance(card, CardConfig):
            return card
        found = self.cards.get(card)
        if found is None:
            raise KeyError(f"unknown card {card!r}")
        return found

    def _advance(self, run: _Run) -> None:
        """Submit waiting jobs and collect finished ones until nothing changes."""
        progressed = True
        while progressed:
            progressed = False
            for job in run.jobs.values():
                if job.status == "waiting":
                    progressed |= self._try_submit(run, job)
                elif job.status == "pending":
                    progressed |= self._collect(run, job)

    def _try_submit(self, run: _Run, job: _Job) -> bool:
        job.fp = fingerprint(job.job.config, metadata_revision=run.revision,
                             engine_version=self.engine_version, alliance_epoch=run.epoch)
        cached = self.cache.get(job.fp)
        if cached is not None:
            self._finish(run, job, result=cached, cache_hit=True)
            return True
        error = self.cache.error(job.fp)
        if error is not None and error["kind"] != "infrastructure":
            self._finish(run, job, error=error, cache_hit=True)  # a settled verdict
            return True
        self.queue.submit(job.fp, job.job.config)
        job.status = "pending"
        self._collect(run, job)
        return True

    def _collect(self, run: _Run, job: _Job) -> bool:
        assert job.fp is not None
        state = self.queue.state(job.fp)
        if state == "done":
            result = self.cache.get(job.fp)
            if result is None:
                self._finish(run, job, error={"kind": "infrastructure",
                                              "message": "result expired from the cache"})
            else:
                self._finish(run, job, result=result)
            return True
        if state == "failed":
            error = self.cache.error(job.fp) or {
                "kind": "infrastructure",
                "message": "engine job failed without a classified error",
            }
            self._finish(run, job, error=error)
            return True
        return False

    def _finish(self, run: _Run, job: _Job, *, result: dict | None = None,
                error: dict | None = None, cache_hit: bool = False) -> None:
        job.status = "done" if result is not None else "failed"
        job.result, job.error, job.cache_hit = result, error, cache_hit
        self._log(run, job)

    def _log(self, run: _Run, job: _Job) -> None:
        """One structured line per job; aggregate counts only, no respondent data."""
        timing = {} if job.cache_hit or job.fp is None else self.cache.timing(job.fp)
        line = {
            "fingerprint": job.fp,
            "card_id": run.card_id,
            "part": job.job.part,
            "state": job.status,
            "queue_wait_s": _span(timing, "submitted_at", "started_at"),
            "engine_s": _span(timing, "started_at", "finished_at"),
            "rows": _engine_rows(job.result) if job.result is not None else None,
            "cache_hit": job.cache_hit,
            "error_kind": job.error["kind"] if job.error else None,
            "error_type": job.error.get("type") if job.error else None,
            "engine_version": self.engine_version,
            "metadata_revision": run.revision,
        }
        log.info(json.dumps(line, sort_keys=True))

    # -- status and assembly ----------------------------------------------

    def _status(self, run: _Run) -> CardRunStatus:
        jobs = list(run.jobs.values())
        finished = [j for j in jobs if j.status in ("done", "failed")]
        errors: dict[str, dict] = {}
        for j in _anchor_first(run, jobs):
            if j.status == "failed" and j.error is not None:
                kind = j.error["kind"]
                entry = errors.setdefault(j.job.part, {
                    "kind": kind,
                    "message": client_message(kind, j.error["message"]),
                    "fingerprint": j.error.get("fingerprint") or j.fp,
                    "jobs": [],
                })
                entry["jobs"].append(j.job.key)
        if len(finished) < len(jobs):
            return CardRunStatus("running", len(finished), len(jobs), None, errors)
        if jobs and (not any(j.status == "done" for j in jobs) or _ranking_anchor_failed(run)):
            return CardRunStatus("failed", len(finished), len(jobs), None, errors)
        try:
            result = self._assemble(run)
        except (ValueError, KeyError, TypeError) as exc:  # e.g. conflicting or malformed
            # engine rows; never hidden, never a 500
            errors["assembly"] = {"kind": "config", "message": f"{type(exc).__name__}: {exc}",
                                  "fingerprint": None, "jobs": []}
            return CardRunStatus("failed", len(finished), len(jobs), None, errors)
        state: RunState = "partial" if errors else "done"
        return CardRunStatus(state, len(finished), len(jobs), result, errors)

    def _assemble(self, run: _Run) -> dict:
        if run.selection:
            (job,) = run.jobs.values()
            return translate_selection(job.result, job.job.config).model_dump()
        if run.values:
            (job,) = run.jobs.values()
            return translate_values(job.result, job.job.config["request"]["grouping_sets"][0][0]).model_dump()
        plan, card = run.plan, run.card
        by_name = {r.identity.base_name: r.obs_id for r in plan.rounds}
        anchor = by_name[plan.anchor]
        if card.family in RANKING_FAMILIES:
            anchor = _ranking_anchor(run, anchor)
        compare = by_name[plan.compare] if plan.compare else None
        done = [_own_rows(j) for j in run.jobs.values() if j.status == "done"]
        context = TranslateContext(
            card_id=run.card_id,
            state=plan.state,
            rounds=rounds_block(plan, anchor, compare),
            round_order=[r.obs_id for r in plan.rounds],
            labels={r.obs_id: r.label for r in plan.rounds},
            anchor=anchor,
            compare=compare,
            unavailable=[{"part": p, "reason": r} for p, r in plan.unavailable],
            not_asked=[{"part": p, "rounds": list(names)} for p, names in plan.not_asked],
            rules=self.rules,
            rules_version=self.rules.version,
            engine_version=self.engine_version,
            metadata_revision=run.revision,
            alliance_epoch=run.epoch,
        )
        if card.family in BENCHMARK_FAMILIES:
            job = run.jobs["benchmark"]
            return translate_benchmark(card, job.result, job.job.config, run.endpoint_parties, context).model_dump()
        if card.family in RELATIONSHIP_FAMILIES:
            job = run.jobs["relationship"]
            return translate_relationship(card, job.result, job.job.config, run.majors, context).model_dump()
        if card.family in RANKING_FAMILIES:
            results = {_job_obs(j.job.config): j.result
                       for j in run.jobs.values() if j.status == "done"}
            failed = {_job_obs(j.job.config) for j in run.jobs.values() if j.status == "failed"}
            return translate_ranked(card, results, context, failed=failed,
                                    labels=self.seat_labels).model_dump()
        if card.all_party_scenarios:  # the columns are the scenarios the compiled request asked for
            asked = next(iter(run.jobs.values())).job.config["request"]["scenarios"]
            card = card.model_copy(update={"scenarios": asked})
        result = merge_results(done) if len(done) > 1 else (done[0] if done else {})
        payload = translate_grid(card, get_family(card.family), result, context)
        return payload.model_dump()


def _own_rows(job) -> dict:
    """A per-survey grid job's result without the rows of the anchor it also read as the caste reference."""
    key = job.job.key
    return only_observation(job.result, key.split(":", 1)[1]) if key.startswith("grid:") else job.result


def _job_obs(config: dict) -> str:
    """The observation a ranking job ranks: its target, or a comparison's target."""
    ranking = config["ranking"]
    return (ranking["target"] or config["request"]["comparisons"][0]["target"])[0]


def _ranking_anchor(run: _Run, planned: str) -> str:
    """The anchor among a ranking run's jobs; the latest asked round if the anchor did not ask."""
    asked = [_job_obs(j.job.config) for j in run.jobs.values()]
    if planned in asked:
        return planned
    order = [r.obs_id for r in run.plan.rounds]
    return max(asked, key=order.index)


def _anchor_first(run: _Run, jobs: list[_Job]) -> list[_Job]:
    """Failed ranking jobs share one error entry; the anchor's message, which fails the card, leads."""
    if run.selection or run.card.family not in RANKING_FAMILIES:
        return jobs
    by_name = {r.identity.base_name: r.obs_id for r in run.plan.rounds}
    anchor = _ranking_anchor(run, by_name[run.plan.anchor])
    return sorted(jobs, key=lambda j: _job_obs(j.job.config) != anchor)


def _ranking_anchor_failed(run: _Run) -> bool:
    if run.selection or run.card.family not in RANKING_FAMILIES:
        return False
    by_name = {r.identity.base_name: r.obs_id for r in run.plan.rounds}
    anchor = _ranking_anchor(run, by_name[run.plan.anchor])
    return any(j.status == "failed" and _job_obs(j.job.config) == anchor
               for j in run.jobs.values())


def _engine_rows(result: dict) -> int:
    return sum(len(result.get(name) or ()) for name in _ENGINE_ARRAYS)


def _span(timing: dict[str, float], start: str, end: str) -> float | None:
    if start in timing and end in timing:
        return round(max(timing[end] - timing[start], 0.0), 3)
    return None
