"""Composite table cells (value, delta, trend, secondary text, flags).

Assembly only: every number is copied from an engine row. Deltas come from
``delta_*`` rows, never from subtracting shares. A round with no value is
None + ``not_asked``; None is never turned into zero.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from matbodh_dashboard.normalise.rows import NormalRow

NOT_ASKED = "not_asked"
NOT_CONTENDER = "not_contender"

_DELTA_OF = {
    "support_share": "delta_support",
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


@dataclass(frozen=True)
class ScoreboardRow:
    party: str
    vote: Cell
    seats_ac: Cell | None
    seats_pc: Cell | None
    gender_gap: Cell | None


Key = tuple[str, str, str | None]  # (measure, series, obs_id)


def _statewide(r: NormalRow) -> bool:
    return all(is_sub for _, _, is_sub in r.dims)


def _index(rows: Sequence[NormalRow], keep: Callable[[NormalRow], bool],
           series_of: Callable[[NormalRow], tuple]) -> dict[tuple, NormalRow]:
    out: dict[tuple, NormalRow] = {}
    for r in rows:
        if keep(r):
            out.setdefault((r.measure, *series_of(r), r.obs_id), r)
    return out


def _cell(idx: dict[tuple, NormalRow], measure: str, ident: tuple,
          round_ids: Sequence[str], anchor: str, compare: str | None,
          secondary: str | None = None, delta_measure: str | None = None) -> Cell:
    trend: list[float | None] = []
    flags: set[str] = set()
    for rid in round_ids:
        r = idx.get((measure, *ident, rid))
        value = r.value if r is not None else None
        trend.append(value)
        if value is None:
            flags.add(NOT_ASKED)
        if r is not None and rid == anchor:
            flags |= r.flags
    anchor_row = idx.get((measure, *ident, anchor))
    delta = None
    if compare is not None:
        d = idx.get((delta_measure or _DELTA_OF.get(measure, ""), *ident, anchor))
        delta = d.value if d is not None else None
    return Cell(anchor_row.value if anchor_row is not None else None, delta,
                tuple(trend), secondary, frozenset(flags))


def _has(idx: dict[tuple, NormalRow], measure: str, ident: tuple) -> bool:
    return any(k[0] == measure and k[1:-1] == ident for k in idx)


def build_scoreboard(rows: Sequence[NormalRow], *, round_ids: Sequence[str], anchor: str,
                     compare: str | None, keep: Sequence[str], other_label: str,
                     non_parties: Sequence[str] = ("Undecided", "NOTA")) -> list[ScoreboardRow]:
    idx = _index(rows, _statewide, lambda r: (r.series,))
    present = {r.series for r in rows if _statewide(r)}
    seat_winners = sorted(
        {r.series for r in rows
         if _statewide(r) and r.measure in ("seats_ac", "seats_pc")
         and r.value is not None and r.value > 0}
        - set(keep) - {other_label} - set(non_parties))

    order = list(keep)
    for extra in (other_label, *[p for p in non_parties if p in present], *seat_winners):
        if extra not in order:
            order.append(extra)

    def cell(measure: str, party: str, **kw) -> Cell:
        return _cell(idx, measure, (party,), round_ids, anchor, compare, **kw)

    out: list[ScoreboardRow] = []
    for party in order:
        ident = (party,)
        measure = "support_share" if (_has(idx, "support_share", ident)
                                      or not _has(idx, "vote_share_bench", ident)) \
            else "vote_share_bench"
        vote = cell(measure, party)

        seats: dict[str, Cell | None] = {}
        for m in ("seats_ac", "seats_pc"):
            if party in non_parties:
                seats[m] = Cell(None, None, (), None, frozenset({NOT_CONTENDER}))
            elif _has(idx, m, ident):
                seats[m] = cell(m, party)
            else:
                seats[m] = None

        gender = None
        if _has(idx, "gender_gap", ident):
            f = idx.get(("female_share", party, anchor))
            m_ = idx.get(("male_share", party, anchor))
            sec = None
            if f is not None and m_ is not None and f.value is not None and m_.value is not None:
                sec = f"F {f.value:.1f} · M {m_.value:.1f}"
            gender = cell("gender_gap", party, secondary=sec)
        out.append(ScoreboardRow(party, vote, seats["seats_ac"], seats["seats_pc"], gender))
    return out


def build_opinion_cells(rows: Sequence[NormalRow], *, round_ids: Sequence[str], anchor: str,
                        compare: str | None) -> dict[str, Cell]:
    idx = _index(rows, _statewide, lambda r: (r.scenario,))
    scenarios = sorted({r.scenario for r in rows
                        if _statewide(r) and r.measure == "net_score" and r.scenario})
    out: dict[str, Cell] = {}
    for sc in scenarios:
        pos = idx.get(("positive_share", sc, anchor))
        neg = idx.get(("negative_share", sc, anchor))
        sec = None
        if pos is not None and neg is not None and pos.value is not None \
                and neg.value is not None:
            sec = f"{pos.value:.0f} sat · {neg.value:.0f} dis"
        out[sc] = _cell(idx, "net_score", (sc,), round_ids, anchor, compare, secondary=sec)
    return out


def build_grid(rows: Sequence[NormalRow], *, row_dim: str, round_ids: Sequence[str],
               anchor: str, compare: str | None,
               measure: str = "support_share") -> dict[tuple[str, str], Cell]:
    def on_row_dim(r: NormalRow) -> bool:
        named = [d for d in r.dims if d[0] == row_dim]
        return (len(named) == 1 and not named[0][2]
                and all(sub for n, _, sub in r.dims if n != row_dim))

    def ident(r: NormalRow) -> tuple:
        return (next(v for n, v, _ in r.dims if n == row_dim), r.series)

    idx = _index(rows, on_row_dim, ident)
    keys = {k[1:-1] for k in idx if k[0] == measure}
    return {(v, s): _cell(idx, measure, (v, s), round_ids, anchor, compare)
            for v, s in sorted(keys, key=lambda k: (str(k[0]), k[1]))}
