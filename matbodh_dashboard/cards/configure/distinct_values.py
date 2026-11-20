"""Distinct values of one respondent field, for Configure's filter lists: one SELECT DISTINCT, not an engine run.

The engine path in `values.py` (a full distribution job) stays as it is and is still used for fields
that do not live in the response table. This path asks the response table directly, the way the
engine's prepared responses read it: FINAL, final_valid = 1, status = 1, the included rounds' surveys,
and the field's value passed through the reporting value mapping (`dictGetOrNull`, falling back to the
raw answer), so the list holds the values a filter will match.

Only the rounds the card reads are used: the anchor for a standalone card, the anchor and the
comparison round for a compare card, the pipe window for a trend card.
"""
from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from typing import Literal

from pydantic import BaseModel

from matbodh_dashboard.capability import resolve_anchor
from matbodh_dashboard.cards.config import SEGMENT_FIELDS
from matbodh_dashboard.cards.configure.values import _natural
from matbodh_dashboard.catalogue.store import Catalogue
from matbodh_dashboard.compiler.plan import field_available
from matbodh_dashboard.compiler.requests import SOURCES
from matbodh_dashboard.compiler.rounds import ResolvedRound, pipe_window, resolve_rounds
from matbodh_dashboard.context import StateContext

Mode = Literal["standalone", "compare", "trend"]
QueryFn = Callable[[str, dict[str, object]], Sequence[Sequence[object]]]

MAX_VALUES = 500
_QUALIFIED = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$")

# The same mapping the engine applies to a reporting column (an unmapped answer stays as it is).
VALUES_SQL = """SELECT DISTINCT toString({mapped}) AS value
FROM {response_table} AS response FINAL
WHERE response.`state` = {{state:String}}
AND response.`final_valid` = 1
AND response.`status` = 1
AND {raw} IS NOT NULL
AND response.`survey_id` IN (
    SELECT source_survey_id FROM warehouse.survey_dataset_levels FINAL WHERE dataset_id IN {{dataset_ids:Array(String)}}
)
LIMIT {limit}"""


class DistinctUnavailable(ValueError):
    """The field cannot be listed; the message says why and is safe to show."""


class DistinctValues(BaseModel):
    kind: Literal["filter_values"] = "filter_values"
    field: str
    values: list[str]
    # "engine": this field does not live in the response table, so the caller uses the engine run.
    source: Literal["responses", "engine"]


def rounds_read(mode: Mode | None, ctx: StateContext, catalogue: Catalogue, pipe_rounds: int | None) -> list[ResolvedRound]:
    """The rounds the card reads for this mode (the whole pipe window when the mode is not given)."""
    resolved = resolve_rounds(ctx, catalogue)
    anchor = resolve_anchor(ctx, catalogue)
    if mode == "standalone":
        wanted = {anchor}
    elif mode == "compare":
        wanted = {anchor, ctx.compare_round} - {None}
    else:  # trend, or no mode given: the pipe window (every round when no window is asked for)
        return pipe_window(resolved, anchor, pipe_rounds)[0]
    return [r for r in resolved if r.identity.base_name in wanted]


def _table(name: str) -> str:
    if not _QUALIFIED.fullmatch(name):
        raise ValueError(f"Unsupported table identifier: {name!r}")
    return name


def distinct_values(
    field: str, ctx: StateContext, mode: Mode | None, pipe_rounds: int | None,
    catalogue: Catalogue, run_query: QueryFn, sources: dict[str, str] = SOURCES,
) -> DistinctValues:
    from matbodh_dash.catalog import default_fields

    spec = default_fields().get(field)
    if spec is None or field in SEGMENT_FIELDS or spec.cardinality != "single":
        raise DistinctUnavailable(f"Field {field!r} cannot be used in a filter")
    rounds = rounds_read(mode, ctx, catalogue, pipe_rounds)
    missing = [r.identity.base_name for r in rounds if not field_available(r.dataset, field)]
    if missing:
        raise DistinctUnavailable(f"Field {field!r} needs to exist in every included round; missing in: {', '.join(missing)}")
    ref = spec.reference
    if spec.source != "rmt" or ref is None:
        return DistinctValues(field=field, values=[], source="engine")

    raw = ref.value_expression("response")
    mapped = (f"if({raw} IS NULL, {raw}, ifNull(dictGetOrNull('{_table(sources['mapping_dictionary'])}', 'value_reporting', "
              f"(response.`state`, '{ref.column}', '{ref.col_key}', ifNull(toString({raw}), ''), '', '', '')), {raw}))")
    rows = run_query(
        VALUES_SQL.format(mapped=mapped, raw=raw, response_table=_table(sources["response_table"]), limit=MAX_VALUES + 1),
        {"state": ctx.state, "dataset_ids": [r.dataset.dataset_id for r in rounds]})
    found = {str(r[0]) for r in rows if r[0] not in (None, "")}
    if len(found) > MAX_VALUES:
        raise DistinctUnavailable(f"Field {field!r} has more than {MAX_VALUES} distinct values; it cannot be used as a filter list")
    return DistinctValues(field=field, values=sorted(found, key=_natural), source="responses")
