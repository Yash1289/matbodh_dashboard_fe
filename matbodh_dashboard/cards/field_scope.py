"""Which cut fields describe the seat rather than the respondent, from the engine's own field registry."""
from __future__ import annotations

from functools import lru_cache

_SEAT_ROLES = frozenset({"seat_attribute", "geographic_attribute"})


@lru_cache(maxsize=1)
def _roles() -> dict[str, str]:
    from matbodh_dash.catalog import default_fields

    return {name: spec.role for name, spec in default_fields().items()}


def is_seat_field(name: str) -> bool:
    """True for a seat attribute or a geography (ac_num, pc_num, party_zone ...); a respondent field is not."""
    return _roles().get(name) in _SEAT_ROLES
