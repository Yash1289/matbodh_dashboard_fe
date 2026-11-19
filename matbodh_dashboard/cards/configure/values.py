"""The values of one respondent field, for Configure's filter lists (spec 7.3).

No SQL here and no new engine code: an ordinary distribution job cut by the field already applies
reporting mapping, FINAL, final_valid and readiness, so its dimension values are exactly the values a
filter can match. Values come from respondents of one scenario (the card's, else the anchor round's
first party scenario), the only respondents a card on that scenario reads.
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel

from matbodh_dashboard.capability import resolve_anchor
from matbodh_dashboard.cards.config import SEGMENT_FIELDS, party_scenarios_of
from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.compiler.plan import EngineJob, RunPlan, field_available
from matbodh_dashboard.compiler.requests import build_request, view_config
from matbodh_dashboard.compiler.rounds import pipe_window, resolve_rounds
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import MethodPreset

PART = "values"


class FilterValues(BaseModel):
    kind: Literal["filter_values"] = "filter_values"
    field: str
    values: list[str]


def _natural(value: str) -> list:
    """g2 before g10: digit runs compare as numbers."""
    return [(0, int(part), "") if part.isdigit() else (1, 0, part.lower()) for part in re.split(r"(\d+)", value) if part]


def compile_values(field: str, scenario: str | None, ctx: StateContext, catalogue: Catalogue,
                   preset: MethodPreset, pipe_rounds: int | None) -> RunPlan:
    from matbodh_dash.catalog import default_fields

    anchor = resolve_anchor(ctx, catalogue)
    rounds, _ = pipe_window(resolve_rounds(ctx, catalogue), anchor, pipe_rounds)
    unavailable: list[tuple[str, str]] = []
    not_asked: list[tuple[str, tuple[str, ...]]] = []

    def plan(jobs=()) -> RunPlan:
        return RunPlan(card_id=PART, state=ctx.state, rounds=tuple(rounds), anchor=anchor,
                       compare=None, jobs=tuple(jobs), unavailable=tuple(unavailable),
                       not_asked=tuple(not_asked))

    spec = default_fields().get(field)
    if spec is None or field in SEGMENT_FIELDS or spec.cardinality != "single":
        unavailable.append((PART, f"Field {field!r} cannot be used in a filter"))
        return plan()
    anchor_round = next((r for r in rounds if r.identity.base_name == anchor), rounds[-1])
    if scenario is None:
        found = party_scenarios_of(anchor_round.dataset.scenarios)
        if not found:
            unavailable.append((PART, f"No party scenario is recorded for {anchor}"))
            return plan()
        scenario = found[0]
    asked = [r for r in rounds if scenario in r.dataset.scenarios]
    dropped = [r.identity.base_name for r in rounds if r not in asked]
    if dropped:
        not_asked.append((PART, tuple(dropped)))
    if not asked:
        unavailable.append((PART, f"Scenario {scenario!r} was not asked in any selected round"))
        return plan()
    missing = [r.identity.base_name for r in asked if not field_available(r.dataset, field)]
    if missing:
        unavailable.append((PART, f"Field {field!r} needs to exist in every included round; "
                                  f"missing in: {', '.join(missing)}"))
        return plan()
    request = build_request(state=ctx.state, rounds=asked, scenarios=[scenario], grouping_sets=[[field]],
                            preset=preset, other_grouping=False)
    return plan([EngineJob(PART, "analysis", PART, view_config(request, preset))])


def translate_values(result: Mapping[str, Any], field: str) -> FilterValues:
    """The distinct, non-null values of the field's own grouping set, in natural order."""
    found = {
        str(dim["value"])
        for row in result.get("rows", ())
        if row.get("grouping_set_id") == "g0"
        for dim in [row.get("dimensions", {}).get(field)]
        if dim is not None and dim.get("value") is not None and not dim.get("is_subtotal")
    }
    return FilterValues(field=field, values=sorted(found, key=_natural))
