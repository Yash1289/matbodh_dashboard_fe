"""Bounds on a card sent from the browser (spec 8.1): a trust boundary, so every list is capped.

Run, plan, preview and validate all apply the same limits, so a draft that validates never fails
to run. Each error names its CardConfig path ("@path: message"), as the CardConfig rules do.
"""
from __future__ import annotations

from matbodh_dashboard.cards.config import CardConfig

MAX_ID, MAX_TITLE = 100, 200
MAX_SCENARIOS, MAX_CUTS, MAX_GROUPING_SETS, MAX_FILTERS, MAX_FILTER_VALUES, MAX_PARTIES = 12, 8, 8, 8, 200, 20


def _fail(path: str, message: str) -> None:
    raise ValueError(f"@{path}: {message}")


def check_inline_limits(card: CardConfig) -> None:
    """Raise ValueError naming the field and the limit a card sent from the browser exceeds."""
    if len(card.id) > MAX_ID:
        _fail("id", f"id is at most {MAX_ID} characters")
    if len(card.title) > MAX_TITLE:
        _fail("title", f"title is at most {MAX_TITLE} characters")
    if len(card.scenarios) > MAX_SCENARIOS:
        _fail("scenarios", f"a card has at most {MAX_SCENARIOS} scenarios")
    if len(card.cuts) > MAX_CUTS:
        _fail("cuts", f"a card has at most {MAX_CUTS} cuts")
    if len(card.display_parties) > MAX_PARTIES:
        _fail("display_parties", f"a card shows at most {MAX_PARTIES} parties")
    filters = [("filters", card.filters)]
    if card.rank is not None:
        filters.append(("rank.filters", card.rank.filters))
    for path, specs in filters:
        if len(specs) > MAX_FILTERS:
            _fail(path, f"a card has at most {MAX_FILTERS} filters")
        if any(len(f.values) > MAX_FILTER_VALUES for f in specs):
            _fail(path, f"a filter has at most {MAX_FILTER_VALUES} values")
    if card.benchmark is not None:
        if len(card.benchmark.grouping_sets) > MAX_GROUPING_SETS:
            _fail("benchmark.grouping_sets", f"a card has at most {MAX_GROUPING_SETS} grouping sets")
        if card.benchmark.contenders is not None and len(card.benchmark.contenders) > MAX_PARTIES:
            _fail("benchmark.contenders", f"a card shows at most {MAX_PARTIES} parties")
