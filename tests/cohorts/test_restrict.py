from datetime import datetime, timezone

from matbodh_dashboard.cohorts.models import CohortRef
from matbodh_dashboard.cohorts.restrict import cohort_blockers, respondent_filter

NOW = datetime(2026, 11, 18, tzinfo=timezone.utc)


def cohort(level="ac", ids=(12, 3)):
    return CohortRef(seat_level=level, seat_ids=list(ids), label="L", created_at=NOW)


def test_filter_values_are_strings_and_pc_uses_pc_num():
    assert respondent_filter(cohort("ac")) == {"field": "ac_num", "operator": "in", "values": ["3", "12"]}
    assert respondent_filter(cohort("pc", (7,)))["field"] == "pc_num"


def test_ac_cohort_needs_an_ac_designed_survey():
    assert cohort_blockers(cohort("ac"), "ac") == []
    reasons = cohort_blockers(cohort("ac"), "pc")
    assert len(reasons) == 1 and "AC" in reasons[0]


def test_a_pc_cohort_applies_to_ac_and_pc_surveys_over_any_number_of_rounds():
    for level in ("ac", "pc"):
        assert cohort_blockers(cohort("pc"), level) == []


def test_zone_and_state_surveys_cannot_take_a_seat_cohort():
    for level in ("zone", "state"):
        assert cohort_blockers(cohort("ac"), level) and cohort_blockers(cohort("pc"), level)
