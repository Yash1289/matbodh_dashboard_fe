"""Per-family field coverage maps (spec section 8).

Every key the engine returns in an array a family owns must have a role, so a new
engine key fails the build until it is mapped. The maps live in field_maps/*.yaml:

    top:    {context_status: status, contract: provenance}
    arrays: {rows: {where: {outcome_domain: [party]},
                    roles: {lens: [...], detail: [...], ignored: {key: "reason"}}}}
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

ROLES = frozenset({"lens", "row", "column", "delta", "detail", "status", "provenance",
                   "ignored"})
ARRAYS = ("rows", "scores", "comparisons", "gender_differentials", "populations")
_DIR = Path(__file__).parent / "field_maps"


def _check_role(role: str) -> None:
    if role not in ROLES:
        raise ValueError(f"unknown role {role!r}; expected one of {sorted(ROLES)}")


def parse_field_map(raw: dict) -> dict:
    """Validate a raw YAML mapping into {"top": {key: role}, "arrays": {name: {...}}}."""
    top: dict[str, str] = {}
    for key, role in (raw.get("top") or {}).items():
        _check_role(role)
        top[key] = role
    arrays: dict[str, dict] = {}
    for name, body in (raw.get("arrays") or {}).items():
        if name not in ARRAYS:
            raise ValueError(f"unknown array {name!r}")
        keys: dict[str, str] = {}
        for role, entries in (body.get("roles") or {}).items():
            _check_role(role)
            if role == "ignored":
                for key, reason in (entries or {}).items():
                    if not isinstance(reason, str) or not reason.strip():
                        raise ValueError(f"ignored key {name}.{key} needs a reason")
                    keys[key] = role
                continue
            for key in entries or ():
                if key in keys:
                    raise ValueError(f"{name}.{key} is mapped to two roles")
                keys[key] = role
        arrays[name] = {"where": body.get("where") or {}, "keys": keys}
    return {"top": top, "arrays": arrays}


@lru_cache(maxsize=None)
def _spec(family: str) -> dict:
    path = _DIR / f"{family}.yaml"
    if not path.exists():
        raise KeyError(f"no field map for family {family!r}")
    with path.open(encoding="utf-8") as handle:
        return parse_field_map(yaml.safe_load(handle))


def load_field_map(family: str) -> dict[str, dict[str, str]]:
    """Array name to key to role; top-level keys are under '_top'."""
    spec = _spec(family)
    return {"_top": dict(spec["top"]),
            **{name: dict(body["keys"]) for name, body in spec["arrays"].items()}}


def _owned(item: dict, where: dict) -> bool:
    return all(item.get(field) in values for field, values in where.items())


def unmapped_keys(family: str, result: dict) -> list[str]:
    """Keys the engine returned that the family's map does not know (empty is good)."""
    spec = _spec(family)
    missing = [key for key in result if key not in ARRAYS and key not in spec["top"]]
    for name, body in spec["arrays"].items():
        for item in result.get(name) or ():
            if _owned(item, body["where"]):
                missing.extend(f"{name}.{key}" for key in item if key not in body["keys"])
    return sorted(dict.fromkeys(missing))
