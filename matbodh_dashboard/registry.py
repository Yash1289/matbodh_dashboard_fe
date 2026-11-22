"""Presentation rules registry: order, label, colour and hide display values.

Layered YAML rules (global, then state). The registry never changes numbers;
values without a rule are appended, never dropped. "hidden" hides display only
and is counted. Round order is not a registry concern.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

import yaml

_RULE_KEYS = frozenset(
    {
        "field", "scope", "within", "order", "pin_first", "pin_last",
        "labels", "hidden", "colours", "unknown",
    }
)
_UNKNOWN_POLICIES = frozenset({"append_end", "append_alpha"})
_DEFAULT_UNKNOWN = "append_alpha"


@dataclass(frozen=True)
class _Rule:
    field: str
    state: str | None
    within: str | None
    order: tuple[str, ...] | None
    pin_first: tuple[str, ...] | None
    pin_last: tuple[str, ...] | None
    labels: dict[str, str]
    hidden: tuple[str, ...]
    colours: dict[str, str]
    unknown: str | None


def _str_list(raw: dict[str, Any], key: str, where: str) -> tuple[str, ...] | None:
    if key not in raw:
        return None
    value = raw[key]
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ValueError(f"{where}: '{key}' must be a list of strings")
    return tuple(value)


def _str_map(raw: dict[str, Any], key: str, where: str) -> dict[str, str]:
    value = raw.get(key) or {}
    if not isinstance(value, dict):
        raise ValueError(f"{where}: '{key}' must be a mapping")
    return {str(k): str(v) for k, v in value.items()}


def _parse_rule(raw: Any, where: str) -> _Rule:
    if not isinstance(raw, dict):
        raise ValueError(f"{where}: rule must be a mapping")
    extra = set(raw) - _RULE_KEYS
    if extra:
        raise ValueError(f"{where}: unknown rule keys {sorted(extra)}")
    if not isinstance(raw.get("field"), str) or not raw["field"]:
        raise ValueError(f"{where}: rule needs a 'field'")
    scope = raw.get("scope") or {}
    if not isinstance(scope, dict) or set(scope) - {"state"}:
        raise ValueError(f"{where}: 'scope' supports only 'state'")
    unknown = raw.get("unknown")
    if unknown is not None and unknown not in _UNKNOWN_POLICIES:
        raise ValueError(
            f"{where}: 'unknown' must be one of {sorted(_UNKNOWN_POLICIES)}"
        )
    return _Rule(
        field=raw["field"],
        state=scope.get("state"),
        within=raw.get("within"),
        order=_str_list(raw, "order", where),
        pin_first=_str_list(raw, "pin_first", where),
        pin_last=_str_list(raw, "pin_last", where),
        labels=_str_map(raw, "labels", where),
        hidden=_str_list(raw, "hidden", where) or (),
        colours=_str_map(raw, "colours", where),
        unknown=unknown,
    )


def _matches(pattern: str, value: str) -> bool:
    """Exact match, or prefix match when the pattern ends with a `*` wildcard."""
    if pattern.endswith("*"):
        return value.startswith(pattern[:-1])
    return pattern == value


def _natural_key(value: str) -> list[str | int]:
    """Case-insensitive, with digit runs compared as numbers: AC 2 before AC 10."""
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", value.casefold())]


def _slug(state: str) -> str:
    return state.strip().lower().replace(" ", "-")


def _dedupe(items: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(items))


@dataclass(frozen=True)
class RuleSet:
    rules: tuple[_Rule, ...] = ()
    version: str = ""

    def _select(
        self, field_name: str, state: str | None, within: str | None = None
    ) -> _Rule | None:
        """Rule for a scope: exact `within` first, else the within-less rule."""
        candidates = [
            r for r in self.rules if r.field == field_name and r.state == state
        ]
        for wanted in (within, None):
            for rule in reversed(candidates):  # later rules win
                if rule.within == wanted:
                    return rule
        return None

    def _layers(
        self, field_name: str, states: Sequence[str], within: str | None
    ) -> list[_Rule]:
        layers = [self._select(field_name, None, within)]
        layers += [self._select(field_name, s, within) for s in states]
        return [r for r in layers if r is not None]

    def _hidden_patterns(
        self, field_name: str, states: Sequence[str], within: str | None
    ) -> list[str]:
        out: list[str] = []
        for rule in self._layers(field_name, states, within):
            out += rule.hidden
        return out

    def order(
        self,
        field: str,
        values: Iterable[str],
        *,
        states: Sequence[str] = (),
        within: str | None = None,
    ) -> list[str]:
        present = _dedupe(values)
        layers = self._layers(field, states, within)
        glob = self._select(field, None, within)
        state_rules = [r for r in layers if r is not glob]

        if len(states) == 1 and state_rules and state_rules[0].order is not None:
            base = list(state_rules[0].order)  # single state overrides global
        else:
            base = list(glob.order) if glob and glob.order else []
            for rule in state_rules:
                base += list(rule.order or ())
            base = _dedupe(base)

        def pick(attr: str) -> Any:  # narrowest layer defining the setting wins
            for rule in reversed(layers):
                if getattr(rule, attr) is not None:
                    return getattr(rule, attr)
            return None

        pin_first = pick("pin_first") or ()
        pin_last = pick("pin_last") or ()
        unknown = pick("unknown") or _DEFAULT_UNKNOWN
        hidden = self._hidden_patterns(field, states, within)

        visible = [v for v in present if not any(_matches(h, v) for h in hidden)]
        first = _dedupe(v for p in pin_first for v in visible if _matches(p, v))
        last = _dedupe(
            v
            for p in pin_last
            for v in visible
            if _matches(p, v) and v not in first
        )
        pinned = set(first) | set(last)
        body = [v for v in visible if v not in pinned]
        body_set = set(body)
        known = [v for v in base if v in body_set]
        known_set = set(known)
        rest = [v for v in body if v not in known_set]
        if unknown == "append_alpha":
            rest = sorted(rest, key=_natural_key)
        return first + known + rest + last

    def hidden_count(
        self,
        field: str,
        values: Iterable[str],
        *,
        states: Sequence[str] = (),
        within: str | None = None,
    ) -> int:
        patterns = self._hidden_patterns(field, states, within)
        return sum(
            1 for v in _dedupe(values) if any(_matches(h, v) for h in patterns)
        )

    def presentation(self, state: str) -> dict:
        """The body of GET /api/presentation/{state}. Global rules first, then the state's, so a state's rule wins.

        Party rules give the column order, the pinned-last parties and the colours; every other field gives a row
        order. A setting no rule defines is left out (None / empty) for the caller to default.
        """
        mine = sorted((r for r in self.rules if r.state is None or _slug(r.state) == _slug(state)),
                      key=lambda r: r.state is not None)
        party = [r for r in mine if r.field == "party"]
        colours: dict[str, str] = {}
        for rule in party:
            colours.update(rule.colours)
        return {
            "state": state,
            # A rule that applies only within one parent value orders that parent's children, not the whole field.
            "rowOrder": {r.field: list(r.order) for r in mine if r.field != "party" and r.order and r.within is None},
            "columnOrder": next((list(r.order) for r in reversed(party) if r.order), None),
            "pinLast": next((list(r.pin_last) for r in reversed(party) if r.pin_last is not None), None),
            "entityColors": colours,
        }

    def label(self, field: str, value: str, state: str | None = None) -> str:
        scopes = (state, None) if state else (None,)
        for scope in scopes:
            rule = self._select(field, scope)
            if rule and value in rule.labels:
                return rule.labels[value]
        return value

    def colour(self, field: str, value: str) -> str | None:
        """One colour per canonical label: global rules first, then state rules."""
        ordered = sorted(
            (r for r in self.rules if r.field == field),
            key=lambda r: r.state is not None,
        )
        for rule in ordered:
            if value in rule.colours:
                return rule.colours[value]
        return None


def load_rules(dir: Path) -> RuleSet:
    """Load every *.yaml in `dir` (sorted by name); version = hash of the files."""
    digest = hashlib.sha256()
    rules: list[_Rule] = []
    seen: dict[tuple[str, str | None, str | None], str] = {}
    for path in sorted(Path(dir).glob("*.yaml")):
        raw_bytes = path.read_bytes()
        digest.update(path.name.encode("utf-8") + b"\0" + raw_bytes + b"\0")
        doc = yaml.safe_load(raw_bytes.decode("utf-8-sig")) or {}
        if not isinstance(doc, dict) or not isinstance(doc.get("rules", []), list):
            raise ValueError(f"{path.name}: expected a mapping with a 'rules' list")
        extra = set(doc) - {"rules"}
        if extra:
            raise ValueError(f"{path.name}: unknown top-level keys {sorted(extra)}")
        for i, raw in enumerate(doc.get("rules", [])):
            rule = _parse_rule(raw, f"{path.name}[{i}]")
            key = (rule.field, rule.state, rule.within)
            if key in seen:
                raise ValueError(
                    f"{path.name}[{i}]: duplicate rule for field={rule.field!r}, "
                    f"state={rule.state!r}, within={rule.within!r} "
                    f"(first defined in {seen[key]})"
                )
            seen[key] = f"{path.name}[{i}]"
            rules.append(rule)
    return RuleSet(rules=tuple(rules), version=digest.hexdigest()[:16])
