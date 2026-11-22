"""Translate an engine AnalysisResult into a GridPayload (spec sections 6.3, 7, 8).

Assembly only reshapes: every number is copied from the engine row, never computed.
A missing value stays None with a status; it is never coerced to zero.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.families import FamilySpec, LensSource
from matbodh_dashboard.cards.field_map import load_field_map
from matbodh_dashboard.cards.payload import (
    BaseDetail,
    CellValue,
    Column,
    Cut,
    DeltaValue,
    FamilyMeta,
    GridPayload,
    PopulationValue,
    RowDef,
)
from matbodh_dashboard.cards.field_scope import is_seat_field
from matbodh_dashboard.registry import RuleSet

_PARTY = "party"
_SCENARIO = "scenario"
_OK = {"available", "aligned"}
_NULL = "~null"


@dataclass(frozen=True)
class TranslateContext:
    card_id: str
    state: str
    rounds: dict  # RoundsBlock: items, groups, anchor, compare
    round_order: list[str]  # observation ids in display (metadata) order
    labels: dict[str, str]
    anchor: str  # observation id
    compare: str | None  # observation id
    unavailable: list[dict] = field(default_factory=list)
    not_asked: list[dict] = field(default_factory=list)
    rules: RuleSet = field(default_factory=RuleSet)
    rules_version: str | int = ""
    engine_version: str = ""
    metadata_revision: int = 0
    alliance_epoch: int = 0


def row_key(dims: Sequence[tuple[str, str | None, bool]]) -> str:
    """Member dimensions as `dim=value` joined by `|`; a genuine NULL is `~null`;
    subtotal dimensions are not part of the key."""
    parts = [f"{name}={'~null' if value is None else value}"
             for name, value, subtotal in dims if not subtotal]
    return "|".join(parts) or "overall"


def column_key(scenario: str, series: str | None) -> str:
    return f"{scenario}:{series}" if series is not None else scenario


def _dims(item: dict) -> list[tuple[str, str | None, bool]]:
    out = []
    for name, raw in (item.get("dimensions") or {}).items():
        if isinstance(raw, dict) and "value" in raw:
            out.append((name, raw["value"], bool(raw.get("is_subtotal", False))))
        else:
            out.append((name, raw, False))
    return out


# Row-level engine statuses that say nothing about a lens whose own value is present.
_ROW_LEVEL = frozenset({"missing_or_zero_gender_base"})


def _status(raw: str | None, value) -> str:
    status = "available" if raw is None or raw in _OK or (value is not None and raw in _ROW_LEVEL) else raw
    return "null_value" if value is None and status == "available" else status


def _obs_for(ref: str, tc: TranslateContext) -> str | None:
    if ref == "anchor":
        return tc.anchor
    if ref == "compare":
        return tc.compare
    for item in tc.rounds.get("items", []):
        if item.get("base_name") == ref or item.get("obs_id") == ref:
            return item["obs_id"]
    return ref


def _series(array: str, item: dict) -> tuple[str | None, str]:
    """(series, column kind) of an engine item."""
    if array == "scores":
        return None, "scale"
    if array == "rows" and item.get("outcome_domain") != "party":
        return item.get("option_id"), "option"
    return item.get("party_id"), "party"


class _Translator:
    def __init__(self, config: CardConfig, spec: FamilySpec, result: dict, tc: TranslateContext):
        self.config, self.spec, self.result, self.tc = config, spec, result, tc
        self.mode = config.comparison.mode
        self.field_map = load_field_map(config.family)
        self.context_status = result.get("context_status") or {}
        self.cut_order = {f"g{i}": list(cut) for i, cut in enumerate(config.cuts)}
        self.cuts: dict[str, _Cut] = {}
        self.columns: dict[str, Column] = {}
        self.column_series: dict[str, str | None] = {}
        self.available_lenses: set[str] = set()
        self.hidden = 0
        self._build_selector()

    # -- selection ----------------------------------------------------------------

    def _build_selector(self) -> None:
        config, tc = self.config, self.tc
        if self.mode == "standalone":
            scenarios = set(config.scenarios)
            # Several chosen surveys: every round the card read, each its own observation.
            self.used_obs = set(tc.round_order) if len(config.surveys) > 1 else {tc.anchor}
            self.keep = lambda i: (i.get("observation_id") in self.used_obs
                                   and i.get("scenario_id") in scenarios)
        elif self.mode == "trend":
            scenario = config.scenarios[0]
            self.used_obs = set(tc.round_order)
            self.keep = lambda i: i.get("scenario_id") == scenario
        else:
            target = config.comparison.target
            self.target_obs = _obs_for(target.round, tc)
            self.reference_obs = _obs_for(config.comparison.reference.round, tc)
            self.used_obs = {self.target_obs}
            self.keep = lambda i: (i.get("observation_id") == self.target_obs
                                   and i.get("scenario_id") == target.scenario)

    @staticmethod
    def _in_domain(item: dict, source: LensSource) -> bool:
        return source.domain is None or item.get("outcome_domain") in source.domain

    # -- structure ----------------------------------------------------------------

    def _cut(self, item: dict) -> _Cut:
        gid = item["grouping_set_id"]
        if gid not in self.cuts:
            members = [name for name, _, subtotal in _dims(item) if not subtotal]
            order = self.cut_order.get(gid)
            self.cuts[gid] = _Cut(gid, order if order and set(order) == set(members) else members)
        return self.cuts[gid]

    def _row(self, cut: _Cut, item: dict) -> RowDef:
        dims = _dims(item)
        members = sorted((d for d in dims if not d[2]),
                         key=lambda d: cut.dimensions.index(d[0]) if d[0] in cut.dimensions else 99)
        key = row_key(members)
        if key not in cut.rows:
            state = self.tc.state
            labels = {name: (None if value is None else str(self.tc.rules.label(name, value, state)))
                      for name, value, _ in members}
            cut.rows[key] = RowDef(key=key, labels=labels,
                                   subtotal=[name for name, _, subtotal in dims if subtotal])
        return cut.rows[key]

    def _column(self, item: dict, array: str, scenario: str, source: LensSource) -> str:
        series, kind = _series(array, item)
        key = column_key(scenario, series)
        if key not in self.columns:
            applies = [lid for lid, s in self.spec.lens_sources.items()
                       if (s.array, s.domain) == (source.array, source.domain)]
            rules, state = self.tc.rules, self.tc.state
            if kind == "party":
                label, colour = rules.label(_PARTY, series, state), rules.colour(_PARTY, series)
            elif kind == "option":
                label, colour = str(series), None
            else:
                label, colour = rules.label(_SCENARIO, scenario, state), None
            self.columns[key] = Column(
                key=key, label=str(label), scenario=scenario, kind=kind, colour=colour,
                lenses=None if len(applies) == len(self.spec.lenses) else applies)
            self.column_series[key] = series if kind == "party" else None
        return key

    # -- cells --------------------------------------------------------------------

    def _detail(self, array: str, item: dict) -> dict:
        roles = self.field_map.get(array, {})
        return {k: item[k] for k, role in roles.items() if role == "detail" and k in item}

    def _cells(self) -> None:
        for lens in self.spec.lenses:
            source = self.spec.lens_sources[lens.id]
            for item in self.result.get(source.array) or ():
                if (not self._in_domain(item, source) or not self.keep(item)
                        or source.field not in item):
                    continue
                cut = self._cut(item)
                row = self._row(cut, item)
                scenario, obs = item["scenario_id"], item["observation_id"]
                column = self._column(item, source.array, scenario, source)
                value = item[source.field]
                # The impact lens has its own engine status; the other lenses use coverage_status.
                raw = item.get("impact_status") if source.field == "size_of_impact_pp" else None
                status = _status(raw or item.get("coverage_status"), value)
                if value is None and self.context_status.get(f"{obs}:{scenario}") == "no_eligible_result":
                    status = "no_eligible_result"
                cut.cells.append(CellValue(row=row.key, column=column, round=obs, lens=lens.id,
                                           value=value, status=status))
                if value is not None:
                    self.available_lenses.add(lens.id)
                detail = self._detail(source.array, item)
                if detail:
                    cut.bases.setdefault((row.key, column, obs), {}).update(detail)

    def _deltas(self) -> None:
        if self.mode != "compare":
            return
        target, reference = self.config.comparison.target, self.config.comparison.reference
        wanted = ([self.target_obs, target.scenario], [self.reference_obs, reference.scenario])
        comparison_detail = {k for k, role in self.field_map.get("comparisons", {}).items()
                             if role == "detail"}
        for lens in self.spec.lenses:
            source = self.spec.lens_sources[lens.id]
            if not lens.has_delta:
                continue
            for item in self.result.get("comparisons") or ():
                if (item.get("measure") != source.delta_measure
                        or [list(item["target"]), list(item["reference"])] != [list(w) for w in wanted]):
                    continue
                cut = self.cuts.get(item["grouping_set_id"])
                if cut is None:
                    continue
                row = self._row(cut, item)
                party = item.get("party_id")
                column = column_key(target.scenario, party)
                if column not in self.columns:
                    continue
                impact = source.delta_field == "size_of_impact_pp"
                value = item.get(source.delta_field)
                status = _status(item.get("impact_status" if impact else "coverage_status"), value)
                cut.deltas.append(DeltaValue(
                    row=row.key, column=column, lens=lens.id,
                    target=f"{self.target_obs}:{target.scenario}",
                    reference=f"{self.reference_obs}:{reference.scenario}", value=value,
                    reference_value=None if impact else item.get("reference_value"),
                    relative_change_pct=None if impact else item.get("relative_change_pct"),
                    status=status))
                extra = {f"comparison.{k}": item[k] for k in comparison_detail if k in item}
                if extra:
                    cut.bases.setdefault((row.key, column, self.target_obs), {}).update(extra)

    def _population_rows(self) -> None:
        for item in self.result.get("populations") or ():
            if item.get("observation_id") in self.used_obs and "grouping_set_id" in item:
                cut = self._cut(item)
                row = self._row(cut, item)
                if item["observation_id"] == self.tc.anchor and row.key not in cut.population:
                    value = item.get("composition_share")
                    cut.population[row.key] = PopulationValue(
                        row=row.key, value=value, status="available" if value is not None else "null_value")

    # -- presentation rules -------------------------------------------------------

    def _apply_column_rules(self) -> None:
        rules, state = self.tc.rules, self.tc.state
        parties = list(dict.fromkeys(s for s in self.column_series.values() if s is not None))
        visible = rules.order(_PARTY, parties, states=[state])
        self.hidden += rules.hidden_count(_PARTY, parties, states=[state])
        gone = {k for k, s in self.column_series.items() if s is not None and s not in visible}
        rank = {s: i for i, s in enumerate(visible)}
        scenario_rank = {s: i for i, s in enumerate(self.config.scenarios)}
        ordered = sorted(
            (c for k, c in self.columns.items() if k not in gone),
            key=lambda c: (scenario_rank.get(c.scenario, 99),
                           rank.get(self.column_series[c.key], 0)
                           if self.column_series[c.key] is not None else 0))
        self.columns = {c.key: c for c in ordered}
        for cut in self.cuts.values():
            cut.drop_columns(gone)

    def _apply_row_rules(self) -> None:
        """Order each cut's rows level by level (a level's values are ordered inside their parent value, which
        selects a rule's `within`), and drop a row when any of its values is hidden. Null values sort last."""
        rules, state = self.tc.rules, self.tc.state
        for cut in self.cuts.values():
            parts = {key: [tuple(p.partition("=")[::2]) for p in key.split("|")] for key in cut.rows if "=" in key}
            groups: dict[tuple[str, str | None], list[str]] = {}
            for levels in parts.values():
                for i, (name, value) in enumerate(levels):
                    if value != _NULL:
                        groups.setdefault((name, levels[i - 1][1] if i else None), []).append(value)
            order = {g: rules.order(g[0], values, states=[state], within=g[1]) for g, values in groups.items()}
            rank: dict[str, tuple[int, ...]] = {}
            for key, levels in parts.items():
                ranks = []
                for i, (name, value) in enumerate(levels):
                    visible = order.get((name, levels[i - 1][1] if i else None), [])
                    if value == _NULL:
                        ranks.append(len(visible))
                    elif value in visible:
                        ranks.append(visible.index(value))
                    else:
                        break  # hidden by the rules
                else:
                    rank[key] = tuple(ranks)
            gone = {key for key in parts if key not in rank}
            self.hidden += len(gone)
            cut.drop_rows(gone)
            kept = [k for k in cut.rows if k not in gone]
            cut.rows = {k: cut.rows[k] for k in sorted(kept, key=lambda k: rank.get(k, (len(kept),)))}

    # -- output -------------------------------------------------------------------

    def run(self) -> GridPayload:
        self._cells()
        self._deltas()
        self._population_rows()
        self._apply_column_rules()
        self._apply_row_rules()
        tc, spec = self.tc, self.spec
        lenses = [lens for lens in spec.lenses if lens.id in self.available_lenses]
        default = (spec.default_lens if spec.default_lens in self.available_lenses
                   else (lenses[0].id if lenses else spec.default_lens))
        if not lenses:
            lenses = [lens for lens in spec.lenses if lens.id == default]
        contract = self.result.get("contract") if isinstance(self.result.get("contract"), dict) else {}
        coverage = ([{"job": "grid", "part": "grid", "coverage": contract["coverage"]}]
                    if "coverage" in contract else [])
        return GridPayload(
            family=self.config.family, card_id=tc.card_id, mode=self.mode, state=tc.state,
            rounds=tc.rounds,
            meta=FamilyMeta(family=spec.name, lenses=lenses, default_lens=default,
                            capabilities=spec.capabilities),
            columns=list(self.columns.values()),
            cuts=[self.cuts[g].build() for g in sorted(self.cuts, key=_cut_sort)],
            unavailable=tc.unavailable, not_asked=tc.not_asked, coverage=coverage,
            provenance={"contract": contract, "resolved_datasets": contract.get("resolved_datasets")},
            hidden_count=self.hidden, rules_version=tc.rules_version,
            seat_fields=sorted({f for cut in self.config.cuts for f in cut if is_seat_field(f)}),
            engine_version=tc.engine_version, metadata_revision=tc.metadata_revision,
            alliance_epoch=tc.alliance_epoch)


def _cut_sort(gid: str):
    return (0, int(gid[1:])) if gid[:1] == "g" and gid[1:].isdigit() else (1, gid)


@dataclass
class _Cut:
    id: str
    dimensions: list[str]
    rows: dict[str, RowDef] = field(default_factory=dict)
    cells: list[CellValue] = field(default_factory=list)
    deltas: list[DeltaValue] = field(default_factory=list)
    bases: dict[tuple, dict] = field(default_factory=dict)
    population: dict[str, PopulationValue] = field(default_factory=dict)

    def drop_columns(self, gone: set[str]) -> None:
        if not gone:
            return
        self.cells = [c for c in self.cells if c.column not in gone]
        self.deltas = [d for d in self.deltas if d.column not in gone]
        self.bases = {k: v for k, v in self.bases.items() if k[1] not in gone}

    def drop_rows(self, gone: set[str]) -> None:
        if not gone:
            return
        self.cells = [c for c in self.cells if c.row not in gone]
        self.deltas = [d for d in self.deltas if d.row not in gone]
        self.bases = {k: v for k, v in self.bases.items() if k[0] not in gone}
        self.population = {k: v for k, v in self.population.items() if k not in gone}

    def build(self) -> Cut:
        return Cut(id=self.id, dimensions=self.dimensions, rows=list(self.rows.values()),
                   cells=self.cells, deltas=self.deltas,
                   bases=[BaseDetail(row=r, column=c, round=o, fields=f)
                          for (r, c, o), f in self.bases.items()],
                   population=list(self.population.values()))


def merge_results(results: list[dict]) -> dict:
    """One engine result from the per-survey jobs of a card: row lists are joined, objects are merged
    (each survey's entries are keyed by its own observation), anything else keeps the first value."""
    merged: dict = {}
    for result in results:
        for key, value in result.items():
            if key not in merged:
                merged[key] = list(value) if isinstance(value, list) else dict(value) if isinstance(value, dict) else value
            elif isinstance(value, list):
                merged[key] = [*merged[key], *value]
            elif isinstance(value, dict) and isinstance(merged[key], dict):
                merged[key] = {**value, **merged[key]} if key != "contract" else _merge_contract(merged[key], value)
    return merged


def only_observation(result: dict, obs: str) -> dict:
    """A job's result without the rows of other observations (a clubbed survey job also reads the anchor
    round as the caste reference, and the anchor's own job already supplies its rows)."""
    return {key: ([i for i in value if not isinstance(i, dict) or i.get("observation_id", obs) == obs]
                  if isinstance(value, list) else value) for key, value in result.items()}


def _merge_contract(first: dict, other: dict) -> dict:
    return {k: ({**other[k], **first[k]} if isinstance(first.get(k), dict) and isinstance(other.get(k), dict) else first.get(k, other.get(k)))
            for k in {*first, *other}}


def translate_grid(config: CardConfig, spec: FamilySpec, result: dict,
                   tc: TranslateContext) -> GridPayload:
    return _Translator(config, spec, result, tc).run()
