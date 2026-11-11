"""Helpers for the ranked translator tests (aggregate engine samples only)."""
from __future__ import annotations

import copy

from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.translate import TranslateContext
from tests.cards.samples import load_sample

PM = "pm_satisfaction"


def load_rank_sample(name: str) -> dict:
    return load_sample(name)


def seat_card(**overrides) -> CardConfig:
    data = {"id": "ranking.test", "family": "seat_ranking", "section": "rankings",
            "title": "T", "scenarios": [PM], "rank": {"metric": "net_score", "level": "ac"}}
    data.update(overrides)
    return CardConfig.model_validate(data)


def demographic_card(**overrides) -> CardConfig:
    data = {"id": "ranking.demo", "family": "demographic_ranking", "section": "rankings",
            "title": "T", "scenarios": ["vs_voting_intention"],
            "rank": {"metric": "support_share", "party_id": "NDA", "level": "caste",
                     "partition_by": ["ac_num"], "top_k": 3}}
    data.update(overrides)
    return CardConfig.model_validate(data)


def ranked_ctx(card_id: str, obs_ids: list[str], anchor: str) -> TranslateContext:
    items = [{"obs_id": o, "label": f"R{o[1:]}", "base_name": f"2027 VS CAPI R{o[1:]}",
              "cycle": "2027 VS", "series": "CAPI", "round": int(o[1:]),
              "dataset_id": f"2027 VS CAPI R{o[1:]}",
              "version": "normal", "fallback": False, "seats": 403, "borrowed": 0,
              "seats_source": "metadata"} for o in obs_ids]
    groups = [{"cycle": "2027 VS", "series": "CAPI", "obs_ids": obs_ids}]
    return TranslateContext(
        card_id=card_id, state="Uttar Pradesh",
        rounds={"items": items, "groups": groups, "anchor": anchor, "compare": None},
        round_order=obs_ids, labels={o: o for o in obs_ids}, anchor=anchor, compare=None,
        rules_version="test", engine_version="0.8.0", metadata_revision=1, alliance_epoch=0)


def variant(result: dict, drop_seats=(), shift_rank: int = 0, drop_rows=()) -> dict:
    """A clearly synthetic later-round result derived from a real sample.

    Used only to exercise cross-round lookups; never presented as engine output.
    """
    out = copy.deepcopy(result)
    dropped = {str(s) for s in drop_seats}
    out["rows"] = [r for i, r in enumerate(out["rows"])
                   if str(r.get("seat_id")) not in dropped and i not in set(drop_rows)]
    if shift_rank:
        for row in out["rows"]:
            if row.get("rank") is not None:
                row["rank"] += shift_rank
    return out
