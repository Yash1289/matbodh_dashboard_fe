from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from matbodh_dashboard.cohorts.models import MAX_COHORT_SEATS, CohortRef

NOW = datetime(2026, 11, 18, tzinfo=timezone.utc)


def cohort(**over):
    base = {"seat_level": "ac", "seat_ids": [57, 3, 12], "label": "Top 3 AC · R2", "created_at": NOW}
    base.update(over)
    return CohortRef(**base)


def test_ids_are_sorted_and_deduplicated():
    assert cohort(seat_ids=[57, 3, 12, 3, 57]).seat_ids == [3, 12, 57]


def test_empty_list_rejected():
    with pytest.raises(ValidationError):
        cohort(seat_ids=[])


def test_over_cap_rejected():
    with pytest.raises(ValidationError):
        cohort(seat_ids=list(range(1, MAX_COHORT_SEATS + 2)))
    assert len(cohort(seat_ids=list(range(1, MAX_COHORT_SEATS + 1))).seat_ids) == MAX_COHORT_SEATS


@pytest.mark.parametrize("bad", [0, -1, "12", 1.5, True, None])
def test_non_positive_or_non_integer_ids_rejected(bad):
    with pytest.raises(ValidationError):
        cohort(seat_ids=[3, bad])


def test_label_required_and_stripped():
    assert cohort(label="  Top 3  ").label == "Top 3"
    for bad in ("", "   ", "x" * 121):
        with pytest.raises(ValidationError):
            cohort(label=bad)


def test_level_must_be_ac_or_pc_and_extra_keys_forbidden():
    with pytest.raises(ValidationError):
        cohort(seat_level="zone")
    with pytest.raises(ValidationError):
        cohort(extra=1)
