"""Helpers for the relationship translator tests (aggregate engine sample only).

`result_transition.json` is a trimmed copy of MatBodh-Dash/sample-output/result_transition.json:
every summary, population and contract entry, plus all major-by-major matrix rows and the 30
largest other rows (so non-major rows exist to be dropped). Its labels are the stored sample's
(`BJP+`, `SP+`, `BSP`), not the live alliance table's.
"""
from __future__ import annotations

import copy
from pathlib import Path

from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.cards.translate import TranslateContext
from matbodh_dashboard.registry import RuleSet, load_rules
from tests.cards.ranking_helpers import ranked_ctx
from tests.cards.samples import load_sample

MAJORS = ("BJP+", "SP+", "BSP")
FOCAL = "BJP+"
JOB = {"relationship": {"id": "relationship", "origin": "vs_past", "destination": "vs_voting_intention",
                        "weights": {"source": "base"}, "focal_party": FOCAL}}
RULES_YAML = """\
rules:
  - field: party
    order: [BJP+, SP+, BSP]
    unknown: append_alpha
  - field: gender
    hidden: [Other]
"""


def load_transition() -> dict:
    return load_sample("result_transition.json")


def relationship_card(**over) -> CardConfig:
    data = {"id": "relationship.test", "family": "relationship", "section": "relationships", "title": "T",
            "cuts": [["gender"]],
            "relationship": {"origin": "vs_past", "destination": "vs_voting_intention", "focal_party": FOCAL}}
    data.update(over)
    return CardConfig.model_validate(data)


def job_without_focal() -> dict:
    job = copy.deepcopy(JOB)
    job["relationship"]["focal_party"] = None
    return job


def relationship_rules(tmp_path: Path, *, hide_other: bool = True) -> RuleSet:
    text = RULES_YAML if hide_other else RULES_YAML.replace("hidden: [Other]", "hidden: []")
    (tmp_path / "global.yaml").write_text(text, encoding="utf-8")
    return load_rules(tmp_path)


def relationship_ctx(obs_ids: list[str], anchor: str, rules: RuleSet | None = None) -> TranslateContext:
    base = ranked_ctx("relationship.test", obs_ids, anchor)
    return TranslateContext(**{**base.__dict__, "rules": rules if rules is not None else RuleSet()})
