"""Fixture metadata rows (Uttar Pradesh) and a fake query callable."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date


def dataset_row(
    dataset_id: str,
    variant: str = "normal",
    level: str = "ac",
    round_number: int | None = 1,
    cycle_id: str = "2027 VS",
    revision: int = 1,
    **overrides: object,
) -> dict:
    row: dict = {
        "dataset_id": dataset_id,
        "state": "Uttar Pradesh",
        "survey_name": dataset_id,
        "variant": variant,
        "collection_level": level,
        "cycle_id": cycle_id,
        "round_number": round_number,
        "survey_start_date": date(2027, 1, 1),
        "survey_end_date": date(2027, 1, 31),
        "available_fields": ["age", "gender"],
        "available_fields_miscellaneous": ["religion"],
        "available_scenarios": ["s1"],
        "update_revision": revision,
    }
    row.update(overrides)
    return row


def level_row(dataset_id: str, seats: range, borrowed: range | None = None) -> dict:
    return {
        "dataset_id": dataset_id,
        "seat_ids": list(seats),
        "borrowed": list(borrowed) if borrowed is not None else [],
    }


DATASET_ROWS = [
    dataset_row("2027 VS CAPI R1", round_number=1, revision=3),
    dataset_row("2027 VS CAPI R2", round_number=2, revision=5),
    dataset_row("2027 VS CAPI R2 (Extrapolated)", variant="extrapolated",
                round_number=2, revision=9),
    dataset_row("2027 VS CAPI ST R1", level="zone", round_number=1, revision=4),
]

LEVEL_ROWS = [
    level_row("2027 VS CAPI R1", range(1, 381)),
    level_row("2027 VS CAPI R2", range(1, 404)),
    level_row("2027 VS CAPI R2 (Extrapolated)", range(1, 404), range(381, 404)),
    level_row("2027 VS CAPI ST R1", range(1, 10)),
]


def make_query(dataset_rows=None, level_rows=None):
    """Fake query callable dispatching on the table named in the SQL."""
    datasets = DATASET_ROWS if dataset_rows is None else dataset_rows
    levels = LEVEL_ROWS if level_rows is None else level_rows
    calls: list[str] = []

    def query(sql: str, params: Mapping[str, object]) -> list[dict]:
        calls.append(sql)
        if "survey_dataset_levels" in sql:
            return [dict(r) for r in levels]
        if "survey_datasets" in sql:
            return [dict(r) for r in datasets]
        raise AssertionError(f"unexpected query: {sql}")

    query.calls = calls  # type: ignore[attr-defined]
    return query
