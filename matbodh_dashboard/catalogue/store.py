"""In-memory survey catalogue loaded from ClickHouse metadata tables."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import date
from typing import Literal

from matbodh_dashboard.catalogue.labels import RoundIdentity, parse_round

QueryFn = Callable[[str, Mapping[str, object]], list[dict]]

_DATASETS_SQL = (
    "SELECT dataset_id, state, survey_name, variant, collection_level, cycle_id, "
    "round_number, survey_start_date, survey_end_date, available_fields, "
    "available_fields_miscellaneous, available_scenarios, update_revision "
    "FROM warehouse.survey_datasets FINAL WHERE is_active = 1"
)
_LEVELS_SQL = (
    "SELECT dataset_id, groupArray(level_id) AS seat_ids, "
    "groupArrayIf(level_id, is_borrowed = 1) AS borrowed "
    "FROM warehouse.survey_dataset_levels FINAL WHERE is_active = 1 "
    "GROUP BY dataset_id"
)


@dataclass(frozen=True)
class DatasetVersion:
    dataset_id: str
    survey_name: str
    variant: Literal["normal", "extrapolated"]
    level: Literal["ac", "pc", "zone", "state"]
    seat_ids: frozenset[int]
    borrowed_seat_ids: frozenset[int]
    fields: frozenset[str]
    scenarios: frozenset[str]
    start_date: date | None
    end_date: date | None
    revision: int


@dataclass(frozen=True)
class CatalogueRound:
    identity: RoundIdentity
    level: str
    normal: DatasetVersion | None
    extrapolated: DatasetVersion | None

    def version(
        self, mode: Literal["extrapolated", "matched"]
    ) -> tuple[DatasetVersion, bool]:
        """Return (dataset, fallback_used); matched always uses Normal."""
        if mode == "extrapolated" and self.extrapolated is not None:
            return self.extrapolated, False
        if self.normal is None:
            raise KeyError(f"round {self.identity.base_name!r} has no normal dataset")
        return self.normal, mode == "extrapolated"


class Catalogue:
    def __init__(
        self,
        rounds: Mapping[tuple[str, str], CatalogueRound],
        revision: int,
        skipped: tuple[tuple[str, str], ...] = (),
    ) -> None:
        self._rounds = dict(rounds)
        self.revision = revision
        self.skipped = skipped

    def states(self) -> tuple[str, ...]:
        return tuple(sorted({state for state, _ in self._rounds}))

    def rounds(self, state: str, level: str | None = None) -> tuple[CatalogueRound, ...]:
        found = [
            r
            for (s, _), r in self._rounds.items()
            if s == state and (level is None or r.level == level)
        ]
        return tuple(sorted(found, key=lambda r: r.identity.sort_key))

    def find(self, state: str, base_name: str) -> CatalogueRound:
        try:
            return self._rounds[(state, base_name)]
        except KeyError:
            raise KeyError(f"no round {base_name!r} for state {state!r}") from None


def load_catalogue(query: QueryFn) -> Catalogue:
    """Load rounds from metadata. Unusable datasets go to Catalogue.skipped."""
    dataset_rows = query(_DATASETS_SQL, {})
    seats_by_dataset = {row["dataset_id"]: row for row in query(_LEVELS_SQL, {})}

    skipped: list[tuple[str, str]] = []
    # (state, base_name) -> {"identity", "level", "normal", "extrapolated"}
    grouped: dict[tuple[str, str], dict] = {}
    revision = 0

    for row in dataset_rows:
        dataset_id = row["dataset_id"]
        revision = max(revision, int(row["update_revision"]))
        try:
            identity = parse_round(
                row["state"], row["survey_name"], row["cycle_id"], row["round_number"]
            )
            identity.sort_key  # validate cycle id is sortable
        except ValueError as exc:
            skipped.append((dataset_id, str(exc)))
            continue
        variant = row["variant"]
        if variant not in ("normal", "extrapolated"):
            skipped.append((dataset_id, f"unknown variant {variant!r}"))
            continue

        levels = seats_by_dataset.get(dataset_id, {})
        version = DatasetVersion(
            dataset_id=dataset_id,
            survey_name=row["survey_name"],
            variant=variant,
            level=row["collection_level"],
            seat_ids=frozenset(levels.get("seat_ids", ())),
            borrowed_seat_ids=frozenset(levels.get("borrowed", ())),
            fields=frozenset(row.get("available_fields") or ())
            | frozenset(row.get("available_fields_miscellaneous") or ()),
            scenarios=frozenset(row.get("available_scenarios") or ()),
            start_date=row.get("survey_start_date"),
            end_date=row.get("survey_end_date"),
            revision=int(row["update_revision"]),
        )
        entry = grouped.setdefault(
            (identity.state, identity.base_name),
            {"identity": identity, "level": version.level, "normal": None,
             "extrapolated": None},
        )
        if entry[variant] is not None:
            skipped.append((dataset_id, f"duplicate {variant} dataset for {identity.base_name!r}"))
            continue
        if entry["level"] != version.level:
            skipped.append((dataset_id, f"collection level {version.level!r} differs from paired dataset"))
            continue
        entry[variant] = version

    rounds = {
        key: CatalogueRound(e["identity"], e["level"], e["normal"], e["extrapolated"])
        for key, e in grouped.items()
    }
    return Catalogue(rounds, revision, tuple(skipped))


def clickhouse_query(client) -> QueryFn:
    """Wrap a clickhouse-connect client into a read-only row-dict query callable."""

    def run(sql: str, params: Mapping[str, object]) -> list[dict]:
        result = client.query(
            sql, parameters=params, settings={"readonly": 1, "max_execution_time": 60}
        )
        return [dict(zip(result.column_names, row)) for row in result.result_rows]

    return run
