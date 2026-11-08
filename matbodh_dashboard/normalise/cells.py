"""Composite table cells (value, delta, trend, secondary text, flags).

Assembly only: every number is copied from an engine row. Deltas come from
``delta_*`` rows, never from subtracting shares. A round with no row is None +
``not_asked``, or None + ``failed`` when the job for that round failed; None is
never turned into zero.
"""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, replace

from matbodh_dashboard.normalise.rows import COMMON_SEATS, NormalRow

NOT_ASKED = "not_asked"
FAILED = "failed"
NOT_CONTENDER = "not_contender"
NO_DELTA = "no_delta"
VOTE_FROM_SEAT_VIEW = "vote_from_seat_view"
WITHIN_OTHER = "within_other"  # an "of which" row: its vote is already inside Other
PARTY_SHARE = "party_share"  # support_share from the ungrouped parties job

_DELTA_OF = {
    "support_share": "delta_support",
    # The parties job carries no comparisons, so this never matches: the
    # cell's delta stays None and is flagged no_delta, never derived.
    PARTY_SHARE: "delta_party_share",
    "vote_share_bench": "delta_support",
    "net_score": "delta_net_score",
    "positive_share": "delta_positive_share",
    "negative_share": "delta_negative_share",
    "seats_ac": "delta_seats_ac",
    "seats_pc": "delta_seats_pc",
}


@dataclass(frozen=True)
class Cell:
    value: float | None
    delta: float | None
    trend: tuple[float | None, ...]
    secondary: str | None
    flags: frozenset[str]
    base: float | None = None  # seat cells: the engine's eligible_seat_count


@dataclass(frozen=True)
class ScoreboardRow:
    party: str
    vote: Cell
    seats_ac: Cell | None
    seats_pc: Cell | None
    gender_gap: Cell | None
    flags: frozenset[str] = frozenset()


Key = tuple[str, str, str | None]  # (measure, series, obs_id)


def _statewide(r: NormalRow) -> bool:
    return all(is_sub for _, _, is_sub in r.dims)


def _index(rows: Sequence[NormalRow], keep: Callable[[NormalRow], bool],
           series_of: Callable[[NormalRow], tuple],
           round_ids: Sequence[str]) -> dict[tuple, NormalRow]:
    """Index selected-round rows; two rows with one key and different values
    are ambiguous and raise rather than silently keeping the first."""
    out: dict[tuple, NormalRow] = {}
    for r in rows:
        if r.obs_id not in round_ids or not keep(r):
            continue
        key = (r.measure, *series_of(r), r.obs_id)
        prior = out.get(key)
        if prior is not None and prior.value != r.value:
            raise ValueError(f"Conflicting duplicate rows for {key}: "
                             f"{prior.value!r} vs {r.value!r}")
        out.setdefault(key, r)
    return out


def _cell(idx: dict[tuple, NormalRow], measure: str, ident: tuple,
          round_ids: Sequence[str], anchor: str, compare: str | None,
          secondary: str | None = None, failed: Collection[str] = ()) -> Cell:
    trend: list[float | None] = []
    flags: set[str] = set()
    for rid in round_ids:
        r = idx.get((measure, *ident, rid))
        value = r.value if r is not None else None
        trend.append(value)
        if r is None:
            flags.add(FAILED if rid in failed else NOT_ASKED)
        elif value is None:
            flags.add(NOT_ASKED)
        if r is not None and rid == anchor:
            flags |= r.flags
    anchor_row = idx.get((measure, *ident, anchor))
    delta = None
    delta_measure = _DELTA_OF.get(measure)
    if compare is not None and delta_measure is not None:
        d = idx.get((delta_measure, *ident, anchor))
        if d is not None:
            delta = d.value
            # e.g. not_covered; null_value would describe the value, not the delta
            flags |= d.flags - {"null_value"}
        if delta is None:
            flags.add(NO_DELTA)
    return Cell(anchor_row.value if anchor_row is not None else None, delta,
                tuple(trend), secondary, frozenset(flags))


def _seat_cell(cell: Cell, anchor_row: NormalRow | None) -> Cell:
    """Seat cells carry the engine's eligible seat count; a paired benchmark's
    counts are on the seats eligible in both rounds, which the cell notes."""
    if anchor_row is None:
        return cell
    secondary = cell.secondary
    if COMMON_SEATS in anchor_row.flags and anchor_row.base is not None:
        secondary = f"on {anchor_row.base:g} seats"
    return replace(cell, base=anchor_row.base, secondary=secondary)


def _has(idx: dict[tuple, NormalRow], measure: str, ident: tuple) -> bool:
    return any(k[0] == measure and k[1:-1] == ident for k in idx)


def build_scoreboard(rows: Sequence[NormalRow], *, round_ids: Sequence[str], anchor: str,
                     compare: str | None, keep: Sequence[str], other_label: str,
                     non_parties: Sequence[str] = ("Undecided", "NOTA"),
                     failed: Mapping[str, Collection[str]] | None = None,
                     ) -> list[ScoreboardRow]:
    """``failed`` maps a column (vote, parties, gender_gap, seats_ac, seats_pc)
    to the rounds whose job for it failed; their cells say ``failed``."""
    failed = failed or {}
    idx = _index(rows, _statewide, lambda r: (r.series,), round_ids)
    # Rows come from the grouped vote job only; ungrouped parties-job shares
    # (party_share) stay inside Other unless the party wins a seat.
    present = {r.series for r in rows if _statewide(r) and r.obs_id in round_ids
               and r.measure == "support_share"}
    seat_winners = sorted(
        {r.series for r in rows
         if _statewide(r) and r.obs_id in round_ids and r.measure in ("seats_ac", "seats_pc")
         and r.value is not None and r.value > 0}
        - set(keep) - {other_label} - set(non_parties))

    order = list(keep)
    for extra in (other_label, *[p for p in non_parties if p in present], *seat_winners):
        if extra not in order:
            order.append(extra)

    def cell(measure: str, party: str, column: str, **kw) -> Cell:
        return _cell(idx, measure, (party,), round_ids, anchor, compare,
                     failed=failed.get(column, ()), **kw)

    out: list[ScoreboardRow] = []
    for party in order:
        ident = (party,)
        row_flags: frozenset[str] = frozenset()
        if party in seat_winners and not _has(idx, "support_share", ident):
            # Outside the keep list: the survey share from the ungrouped parties
            # job; the seat-view share only as a last resort. Either way the
            # party's vote is already counted inside Other.
            row_flags = frozenset({WITHIN_OTHER})
            if _has(idx, PARTY_SHARE, ident) or not _has(idx, "vote_share_bench", ident):
                vote = cell(PARTY_SHARE, party, "parties")
                vote = replace(vote, flags=vote.flags | row_flags)
            else:
                vote = cell("vote_share_bench", party, "parties")
                vote = replace(vote, flags=vote.flags | row_flags | {VOTE_FROM_SEAT_VIEW})
        else:
            vote = cell("support_share", party, "vote")

        contender = party != other_label  # Other is never a benchmark contender
        seats: dict[str, Cell | None] = {}
        for m in ("seats_ac", "seats_pc"):
            if party in non_parties:
                seats[m] = Cell(None, None, (), None, frozenset({NOT_CONTENDER}))
            elif _has(idx, m, ident) or (contender and failed.get(m)):
                seats[m] = _seat_cell(cell(m, party, m), idx.get((m, party, anchor)))
            else:
                seats[m] = None

        gender = None
        if _has(idx, "gender_gap", ident) or (
                failed.get("gender_gap") and not row_flags and party not in non_parties):
            f = idx.get(("female_share", party, anchor))
            m_ = idx.get(("male_share", party, anchor))
            sec = None
            if f is not None and m_ is not None and f.value is not None and m_.value is not None:
                sec = f"F {f.value:.1f} · M {m_.value:.1f}"
            gender = cell("gender_gap", party, "gender_gap", secondary=sec)
        out.append(ScoreboardRow(party, vote, seats["seats_ac"], seats["seats_pc"], gender,
                                 row_flags))
    return out


def build_opinion_cells(rows: Sequence[NormalRow], *, round_ids: Sequence[str], anchor: str,
                        compare: str | None,
                        failed: Mapping[str, Collection[str]] | None = None,
                        ) -> dict[str, Cell]:
    """``failed`` maps a scenario to the rounds whose job for it failed."""
    failed = failed or {}
    idx = _index(rows, _statewide, lambda r: (r.scenario, r.series), round_ids)
    out: dict[str, Cell] = {}
    for key in sorted({k[1:-1] for k in idx if k[0] == "net_score" and k[1] is not None}):
        sc = key[0]
        if sc in out:
            raise ValueError(f"Several net-score series for scenario {sc!r}")
        pos = idx.get(("positive_share", *key, anchor))
        neg = idx.get(("negative_share", *key, anchor))
        sec = None
        if pos is not None and neg is not None and pos.value is not None \
                and neg.value is not None:
            sec = f"{pos.value:.0f} sat · {neg.value:.0f} dis"
        out[sc] = _cell(idx, "net_score", key, round_ids, anchor, compare, secondary=sec,
                        failed=failed.get(sc, ()))
    for sc, rounds in failed.items():  # a failed job returned nothing for these
        if sc not in out:
            out[sc] = _cell(idx, "net_score", (sc, sc), round_ids, anchor, compare,
                            failed=rounds)
    return out


def build_grid(rows: Sequence[NormalRow], *, row_dim: str, round_ids: Sequence[str],
               anchor: str, compare: str | None, measure: str = "support_share",
               failed: Collection[str] = ()) -> dict[tuple[str, str], Cell]:
    def on_row_dim(r: NormalRow) -> bool:
        named = [d for d in r.dims if d[0] == row_dim]
        return (len(named) == 1 and not named[0][2]
                and all(sub for n, _, sub in r.dims if n != row_dim))

    def ident(r: NormalRow) -> tuple:
        return (next(v for n, v, _ in r.dims if n == row_dim), r.series)

    idx = _index(rows, on_row_dim, ident, round_ids)
    keys = {k[1:-1] for k in idx if k[0] == measure}
    return {(v, s): _cell(idx, measure, (v, s), round_ids, anchor, compare, failed=failed)
            for v, s in sorted(keys, key=lambda k: (str(k[0]), k[1]))}
