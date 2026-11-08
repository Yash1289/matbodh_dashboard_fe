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
            raise ValueError(f"no Normal version for {self.identity.base_name}")
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


_LEVELS = ("ac", "pc", "zone", "state")
_VARIANTS = ("normal", "extrapolated")


def _build_version(row: Mapping[str, object], levels: Mapping[str, object] | None):
    """Validate one dataset row and build (identity, version); raise ValueError."""
    identity = parse_round(
        row["state"], row["survey_name"], row["cycle_id"], row["round_number"]
    )
    identity.sort_key  # validate cycle id is sortable
    if row["variant"] not in _VARIANTS:
        raise ValueError(f"unknown variant {row['variant']!r}")
    if row["collection_level"] not in _LEVELS:
        raise ValueError(f"unknown collection level {row['collection_level']!r}")
    try:
        revision = int(row["update_revision"])
    except (TypeError, ValueError):
        raise ValueError(f"invalid update_revision {row['update_revision']!r}") from None
    if levels is None:
        raise ValueError("no active levels")
    version = DatasetVersion(
        dataset_id=row["dataset_id"],
        survey_name=row["survey_name"],
        variant=row["variant"],
        level=row["collection_level"],
        seat_ids=frozenset(levels.get("seat_ids") or ()),
        borrowed_seat_ids=frozenset(levels.get("borrowed") or ()),
        fields=frozenset(row.get("available_fields") or ())
        | frozenset(row.get("available_fields_miscellaneous") or ()),
        scenarios=frozenset(row.get("available_scenarios") or ()),
        start_date=row.get("survey_start_date"),
        end_date=row.get("survey_end_date"),
        revision=revision,
    )
    return identity, version


def load_catalogue(query: QueryFn) -> Catalogue:
    """Load rounds from metadata. Unusable datasets go to Catalogue.skipped.

    Pairing is deterministic: valid datasets are ordered by (state, base_name,
    variant with Normal first, dataset_id). The first dataset of a round fixes
    its collection level; a later dataset with the same variant (duplicate) or a
    different level is skipped. Revision is the max over accepted datasets.
    """
    dataset_rows = query(_DATASETS_SQL, {})
    seats_by_dataset = {row["dataset_id"]: row for row in query(_LEVELS_SQL, {})}

    skipped: list[tuple[str, str]] = []
    candidates: list[tuple[RoundIdentity, DatasetVersion]] = []
    for row in dataset_rows:
        dataset_id = row["dataset_id"]
        try:
            candidates.append(_build_version(row, seats_by_dataset.get(dataset_id)))
        except (ValueError, KeyError) as exc:
            skipped.append((dataset_id, str(exc)))

    candidates.sort(
        key=lambda c: (
            c[0].state,
            c[0].base_name,
            c[1].variant != "normal",
            c[1].dataset_id,
        )
    )
    grouped: dict[tuple[str, str], dict] = {}
    revision = 0
    for identity, version in candidates:
        entry = grouped.setdefault(
            (identity.state, identity.base_name),
            {"identity": identity, "level": version.level, "normal": None,
             "extrapolated": None},
        )
        if entry[version.variant] is not None:
            skipped.append(
                (version.dataset_id,
                 f"duplicate {version.variant} dataset for {identity.base_name!r}")
            )
        elif entry["level"] != version.level:
            skipped.append(
                (version.dataset_id,
                 f"collection level {version.level!r} differs from paired "
                 f"dataset level {entry['level']!r}")
            )
        else:
            entry[version.variant] = version
            revision = max(revision, version.revision)

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
