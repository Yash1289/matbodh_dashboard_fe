"""Card runs: plan a card, run its engine jobs and assemble ordered cells.

Jobs are fingerprinted (config + metadata revision + engine version + alliance
epoch), served from the cache when possible, submitted once per fingerprint
and, for benchmarks, only after the job that supplies their contenders is done.
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
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from typing import Literal

from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.compiler.fingerprint import fingerprint
from matbodh_dashboard.compiler.plan import EngineJob, RunPlan, bind_contenders, plan_card
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.normalise.cells import (
    Cell, build_grid, build_opinion_cells, build_scoreboard,
)
from matbodh_dashboard.normalise.rows import NormalRow, from_analysis, from_benchmark
from matbodh_dashboard.presets import MethodPreset
from matbodh_dashboard.registry import RuleSet
from matbodh_dashboard.runner.cache import ResultCache
from matbodh_dashboard.runner.queue import JobQueue
from matbodh_dashboard.templates import CardTemplate

log = logging.getLogger(__name__)

RunState = Literal["running", "done", "partial", "failed"]
MAX_RUNS = 1000  # run handles kept in memory; the oldest are forgotten first

_PARTY = "party"
_SCENARIO = "scenario"


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
    template: CardTemplate
    plan: RunPlan
    revision: int
    epoch: int
    jobs: dict[str, _Job] = field(default_factory=dict)


class CardRunService:
    def __init__(
        self,
        catalogue: Catalogue,
        preset: MethodPreset,
        templates: dict[str, CardTemplate],
        rules: RuleSet,
        cache: ResultCache,
        queue: JobQueue,
        engine_version: str,
    ) -> None:
        self.catalogue = catalogue
        self.preset = preset
        self.templates = templates
        self.rules = rules
        self.cache = cache
        self.queue = queue
        self.engine_version = engine_version
        self._runs: OrderedDict[str, _Run] = OrderedDict()
        self._lock = threading.RLock()

    # -- public API -------------------------------------------------------

    def plan(self, card_id: str, ctx: StateContext) -> RunPlan:
        return plan_card(self._template(card_id), ctx, self.catalogue, self.preset)

    def start(self, card_id: str, ctx: StateContext) -> str:
        template = self._template(card_id)
        plan = plan_card(template, ctx, self.catalogue, self.preset)
        run = _Run(card_id, template, plan, self.catalogue.revision,
                   self.cache.alliance_epoch())
        run.jobs = {j.key: _Job(j) for j in plan.jobs}
        run_id = uuid.uuid4().hex
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

    def refresh_metadata(self, catalogue: Catalogue) -> int:
        """Replace the catalogue; bumping the epoch invalidates every cached result."""
        with self._lock:
            self.catalogue = catalogue
            return self.cache.bump_epoch()

    # -- job progress -----------------------------------------------------

    def _template(self, card_id: str) -> CardTemplate:
        template = self.templates.get(card_id)
        if template is None:
            raise KeyError(f"unknown card {card_id!r}")
        return template

    def _advance(self, run: _Run) -> None:
        """Submit ready jobs and collect finished ones until nothing changes."""
        progressed = True
        while progressed:
            progressed = False
            for job in run.jobs.values():
                if job.status == "waiting":
                    progressed |= self._try_submit(run, job)
                elif job.status == "pending":
                    progressed |= self._collect(run, job)

    def _try_submit(self, run: _Run, job: _Job) -> bool:
        source_key = job.job.contenders_from
        if source_key is not None:
            source = run.jobs.get(source_key)
            if source is None:
                raise ValueError(f"job {job.job.key!r} depends on unplanned job {source_key!r}")
            if source.status == "failed":
                assert source.error is not None
                job.error = {"kind": source.error["kind"],
                             "message": f"needs job {source_key!r}, which failed: "
                                        f"{source.error['message']}"}
                job.status = "failed"
                return True
            if source.status != "done":
                return False
            job.job = bind_contenders(job.job, self._parties(run, source), self.preset)

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

    def _parties(self, run: _Run, source: _Job) -> list[str]:
        assert source.result is not None
        rows = from_analysis(source.result, run.plan.state)
        return sorted({r.series for r in rows if r.measure == "support_share"})

    def _rows(self, run: _Run, job: _Job) -> list[NormalRow]:
        assert job.result is not None
        if job.job.kind == "benchmark":
            level = job.job.config["benchmark"]["seat_level"]
            return from_benchmark(job.result, run.plan.state, level)
        return from_analysis(job.result, run.plan.state)

    def _log(self, run: _Run, job: _Job) -> None:
        """One structured line per job; aggregate counts only, no respondent data."""
        timing = {} if job.cache_hit or job.fp is None else self.cache.timing(job.fp)
        rows = None
        if job.result is not None:
            try:
                rows = len(self._rows(run, job))
            except (ValueError, KeyError, TypeError):
                rows = None
        line = {
            "fingerprint": job.fp,
            "card_id": run.card_id,
            "part": job.job.part,
            "state": job.status,
            "queue_wait_s": _span(timing, "submitted_at", "started_at"),
            "engine_s": _span(timing, "started_at", "finished_at"),
            "rows": rows,
            "cache_hit": job.cache_hit,
            "error_kind": job.error["kind"] if job.error else None,
            "engine_version": self.engine_version,
            "metadata_revision": run.revision,
        }
        log.info(json.dumps(line, sort_keys=True))

    # -- status and assembly ----------------------------------------------

    def _status(self, run: _Run) -> CardRunStatus:
        jobs = list(run.jobs.values())
        finished = [j for j in jobs if j.status in ("done", "failed")]
        errors: dict[str, dict] = {}
        for j in jobs:
            if j.status == "failed" and j.error is not None:
                entry = errors.setdefault(j.job.part, {**j.error, "jobs": []})
                entry["jobs"].append(j.job.key)
        if len(finished) < len(jobs):
            return CardRunStatus("running", len(finished), len(jobs), None, errors)
        if not any(j.status == "done" for j in jobs):
            return CardRunStatus("failed", len(finished), len(jobs), None, errors)
        try:
            result = self._assemble(run)
        except ValueError as exc:  # e.g. conflicting engine rows; never hidden
            errors["assembly"] = {"kind": "config", "message": str(exc), "jobs": []}
            return CardRunStatus("failed", len(finished), len(jobs), None, errors)
        state: RunState = "partial" if errors else "done"
        return CardRunStatus(state, len(finished), len(jobs), result, errors)

    def _assemble(self, run: _Run) -> dict:
        plan, template = run.plan, run.template
        done = [j for j in run.jobs.values() if j.status == "done"]
        rows = [r for j in done for r in self._rows(run, j)]
        by_name = {r.identity.base_name: r.obs_id for r in plan.rounds}
        round_ids = [r.obs_id for r in plan.rounds]
        anchor = by_name[plan.anchor]
        compare = by_name[plan.compare] if plan.compare else None
        states = [plan.state]

        result: dict = {
            "card_id": run.card_id,
            "operation": template.operation,
            "state": plan.state,
            "rounds": _rounds(plan, anchor, compare),
            "unavailable": [{"part": p, "reason": r} for p, r in plan.unavailable],
            "coverage": [
                {"job": j.job.key, "part": j.job.part, "coverage": j.result["contract"]["coverage"]}
                for j in done
                if isinstance(j.result.get("contract"), dict) and "coverage" in j.result["contract"]
            ],
            "rules_version": self.rules.version,
            "engine_version": self.engine_version,
            "metadata_revision": run.revision,
            "alliance_epoch": run.epoch,
        }

        if template.operation == "scoreboard":
            board = build_scoreboard(rows, round_ids=round_ids, anchor=anchor, compare=compare,
                                     keep=self.preset.keep, other_label=self.preset.other_label)
            by_party = {r.party: r for r in board}
            order = self.rules.order(_PARTY, by_party, states=states)
            result["hidden_count"] = self.rules.hidden_count(_PARTY, by_party, states=states)
            result["scoreboard"] = [
                {**self._series(_PARTY, p, plan.state),
                 "vote": _cell(by_party[p].vote),
                 "seats_ac": _cell(by_party[p].seats_ac),
                 "seats_pc": _cell(by_party[p].seats_pc),
                 "gender_gap": _cell(by_party[p].gender_gap)}
                for p in order
            ]
        elif template.operation == "opinion":
            cells = build_opinion_cells(rows, round_ids=round_ids, anchor=anchor, compare=compare)
            order = self.rules.order(_SCENARIO, cells, states=states)
            result["hidden_count"] = self.rules.hidden_count(_SCENARIO, cells, states=states)
            result["opinion"] = [
                {**self._series(_SCENARIO, sc, plan.state), "cell": _cell(cells[sc])}
                for sc in order
            ]
            result["not_returned"] = [q for q in template.questions if q not in cells]
        else:
            result["grid"], result["hidden_count"] = self._grid(rows, template, plan.state,
                                                                round_ids, anchor, compare)
        return result

    def _grid(self, rows: Sequence[NormalRow], template: CardTemplate, state: str,
              round_ids: list[str], anchor: str, compare: str | None) -> tuple[dict, int]:
        if len(template.slices) != 1:
            raise ValueError(f"card {template.id!r} needs exactly one slice for a grid")
        row_dim = template.slices[0]
        cells = build_grid(rows, row_dim=row_dim, round_ids=round_ids, anchor=anchor,
                           compare=compare)
        values = list(dict.fromkeys(v for v, _ in cells))
        named = [v for v in values if v is not None]
        series = list(dict.fromkeys(s for _, s in cells))
        states = [state]
        value_order = self.rules.order(row_dim, named, states=states)
        if None in values:  # a missing dimension value is shown, never dropped
            value_order.append(None)
        series_order = self.rules.order(_PARTY, series, states=states)
        hidden = (self.rules.hidden_count(row_dim, named, states=states)
                  + self.rules.hidden_count(_PARTY, series, states=states))
        grid_rows = []
        for v in value_order:
            grid_rows.append({
                "value": v,
                "label": self.rules.label(row_dim, v, state) if v is not None else None,
                "series": [{**self._series(_PARTY, s, state), "cell": _cell(cells[(v, s)])}
                           for s in series_order if (v, s) in cells],
            })
        return {"row_dim": row_dim, "rows": grid_rows}, hidden

    def _series(self, field_name: str, value: str, state: str) -> dict:
        return {"series": value, "label": self.rules.label(field_name, value, state),
                "colour": self.rules.colour(field_name, value)}


def _span(timing: dict[str, float], start: str, end: str) -> float | None:
    if start in timing and end in timing:
        return round(max(timing[end] - timing[start], 0.0), 3)
    return None


def _cell(cell: Cell | None) -> dict | None:
    if cell is None:
        return None
    data = asdict(cell)
    data["trend"] = list(cell.trend)
    data["flags"] = sorted(cell.flags)
    return data


def _rounds(plan: RunPlan, anchor: str, compare: str | None) -> dict:
    items = []
    groups: list[dict] = []
    for r in plan.rounds:
        ds = r.dataset
        items.append({
            "obs_id": r.obs_id,
            "label": r.label,
            "base_name": r.identity.base_name,
            "cycle": r.identity.cycle,
            "series": r.identity.series,
            "round": r.identity.round,
            "dataset_id": ds.dataset_id,
            "version": ds.variant,
            "fallback": r.fallback,
            "seats": len(ds.seat_ids),
            "borrowed": len(ds.borrowed_seat_ids),
        })
        key = (r.identity.cycle, r.identity.series)
        if groups and (groups[-1]["cycle"], groups[-1]["series"]) == key:
            groups[-1]["obs_ids"].append(r.obs_id)
        else:
            groups.append({"cycle": key[0], "series": key[1], "obs_ids": [r.obs_id]})
    return {"items": items, "groups": groups, "anchor": anchor, "compare": compare}
