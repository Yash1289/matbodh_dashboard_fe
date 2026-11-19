"""Check a draft card for Configure: CardConfig first, then the engine plan, never a run (spec 8.3).

The frontend holds no rules of its own: every message shown next to a field comes from here.
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from pydantic import ValidationError

from matbodh_dashboard.capability import validate_context
from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.configure.limits import check_inline_limits
from matbodh_dashboard.catalogue.store import RoundNotFound
from matbodh_dashboard.compiler.plan import RunPlan
from matbodh_dashboard.context import StateContext

if TYPE_CHECKING:  # the service imports cards; keep this module importable on its own
    from matbodh_dashboard.runner.service import CardRunService

# CardConfig rules raise ValueError("@<path>: <message>") (see cards/config.py `_fail`).
_PATH_PREFIX = re.compile(r"^(?:Value error, )?@([^:]*): (.*)$", re.DOTALL)


def rounds_payload(plan: RunPlan) -> list[dict[str, Any]]:
    """The rounds a plan reads, in the shape the browser already receives from /cards/plan."""
    return [
        {"obs_id": r.obs_id, "label": r.label, "base_name": r.identity.base_name,
         "round": r.identity.round, "dataset_id": r.dataset.dataset_id, "version": r.dataset.variant,
         "fallback": r.fallback, "seats": len(r.dataset.seat_ids),
         "borrowed": len(r.dataset.borrowed_seat_ids), "seats_source": "metadata"}
        for r in plan.rounds
    ]


def _error(item: dict[str, Any]) -> dict[str, str]:
    """One Pydantic error as {path, message}: the rule's own path when it names one, else the field's."""
    match = _PATH_PREFIX.match(item["msg"])
    if match:
        return {"path": match.group(1), "message": match.group(2)}
    return {"path": ".".join(str(part) for part in item["loc"]), "message": item["msg"]}


def _result(errors: list[dict[str, str]], plan: RunPlan | None = None) -> dict[str, Any]:
    unavailable = [{"reason": reason} for _, reason in plan.unavailable] if plan else []
    return {
        "valid": not errors and not unavailable and plan is not None,
        "errors": errors,
        "unavailable": unavailable,
        "not_asked": [{"part": p, "rounds": list(names)} for p, names in plan.not_asked] if plan else [],
        "notes": list(plan.notes) if plan else [],
        "rounds": rounds_payload(plan) if plan else [],
    }


def validate_draft(draft: dict[str, Any], ctx: StateContext, service: CardRunService) -> dict[str, Any]:
    """Errors per field, then plan-level unavailability. The plan is compiled only for a valid model."""
    try:
        card = CardConfig.model_validate(draft)
    except ValidationError as exc:
        return _result([_error(item) for item in exc.errors(include_url=False)])
    try:
        check_inline_limits(card)  # run would refuse the same card: validate must agree
    except ValueError as exc:
        return _result([_error({"msg": str(exc), "loc": ()})])
    context_errors = validate_context(ctx, service.catalogue)
    if context_errors:
        return _result([{"path": "context", "message": message} for message in context_errors])
    try:
        plan = service.plan(card, ctx)
    except RoundNotFound:
        return _result([{"path": "context", "message": "The survey catalogue changed; reload the page"}])
    return _result([], plan)
