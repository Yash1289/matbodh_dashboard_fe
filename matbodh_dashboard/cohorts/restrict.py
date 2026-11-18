"""Turn a session cohort into the restriction each kind of engine request takes."""

from __future__ import annotations

from matbodh_dashboard.cohorts.models import CohortRef

PC_MEMBERSHIP_REASON = ("PC cohorts across several AC-designed rounds need the AC-to-PC membership; "
                        "not available yet")


def respondent_filter(cohort: CohortRef) -> dict:
    """The engine's respondent filter for the cohort's seats (values must be strings)."""
    return {"field": f"{cohort.seat_level}_num", "operator": "in",
            "values": [str(i) for i in cohort.seat_ids]}


def seat_restriction(cohort: CohortRef) -> dict[str, list[int]]:
    """Seat rankings and benchmarks rank and compare only the cohort's seats (owner decision D-C9).

    The only place to change if a statewide rank of the cohort's seats is ever wanted
    (the engine's `display_seat_ids` instead of `seat_ids`).
    """
    return {"seat_ids": list(cohort.seat_ids)}


def level_mismatch(cohort: CohortRef, card_level: str, noun: str) -> list[str]:
    """A seat card at one level cannot take a cohort of the other level."""
    if cohort.seat_level == card_level:
        return []
    return [f"This card {noun} {card_level.upper()}s; the cohort holds {cohort.seat_level.upper()}s"]


def cohort_blockers(cohort: CohortRef, survey_level: str, round_count: int) -> list[str]:
    """Why the cohort cannot be applied to surveys of this level; empty means it can."""
    if survey_level not in ("ac", "pc"):
        return ["Seat cohorts need AC- or PC-designed surveys"]
    if cohort.seat_level == "ac":
        return [] if survey_level == "ac" else ["An AC cohort needs AC-designed surveys"]
    if survey_level == "ac" and round_count > 1:
        return [PC_MEMBERSHIP_REASON]  # until the host supplies the membership snapshot (plan Task 9)
    return []
