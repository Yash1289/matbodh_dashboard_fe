"""Export real-engine card payloads as frontend test fixtures.

Developer tool, no database: it runs the real translator over the aggregate engine
samples in tests/fixtures/engine_samples and writes one JSON payload per family and
mode into web/src/test/fixtures/cards/.

    python scripts/export_card_fixtures.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))  # lets the script import the tests.cards sample loader

from matbodh_dashboard.cards.config import CardConfig  # noqa: E402
from matbodh_dashboard.cards.families import get_family  # noqa: E402
from matbodh_dashboard.cards.translate import TranslateContext, translate_grid  # noqa: E402
from matbodh_dashboard.registry import load_rules  # noqa: E402
from tests.cards.samples import load_sample  # noqa: E402

FIXTURES_DIR = ROOT / "web" / "src" / "test" / "fixtures" / "cards"
STATE = "Uttar Pradesh"
VS, PM = "vs_voting_intention", "pm_satisfaction"


def _compare(scenario: str, **extra) -> dict:
    return {"mode": "compare", "target": {"scenario": scenario},
            "reference": {"round": "compare", "scenario": scenario}, **extra}


# name -> (sample file, card fields, anchor observation, compare observation)
FIXTURES: dict[str, tuple[str, dict, str, str | None]] = {
    "distribution_standalone": ("result_ac_1_caste_all_final_ultimate_final.json",
                                dict(family="distribution", scenarios=[VS]), "R2", None),
    "distribution_compare": ("result_ac_1_across.json",
                             dict(family="distribution", scenarios=[], comparison=_compare(VS)),
                             "R2", "R1"),
    "distribution_trend": ("result_ac_1_across.json",
                           dict(family="distribution", scenarios=[VS],
                                comparison={"mode": "trend"}), "R2", "R1"),
    "opinion_standalone": ("result_opinion.json", dict(family="opinion", scenarios=[PM]),
                           "R2", None),
    "opinion_compare": ("result_ac_1_across.json",
                        dict(family="opinion", scenarios=[],
                             comparison=_compare(PM, delta_measures=["net_score"])), "R2", "R1"),
    "opinion_trend": ("result_ac_1_across.json",
                      dict(family="opinion", scenarios=[PM], comparison={"mode": "trend"}),
                      "R2", "R1"),
    "gender_differential_standalone": ("result_gd.json",
                                       dict(family="gender_differential", scenarios=[VS]),
                                       "R2", None),
}


def _observations(result: dict) -> list[str]:
    found: set[str] = set()
    for array in ("rows", "scores", "gender_differentials", "populations"):
        found |= {i["observation_id"] for i in result.get(array) or () if i.get("observation_id")}
    for comparison in result.get("comparisons") or ():
        found |= {comparison["target"][0], comparison["reference"][0]}
    return sorted(found)


def _context(card_id: str, result: dict, anchor: str, compare: str | None) -> TranslateContext:
    order = _observations(result)
    items = [{"obs_id": o, "label": o, "base_name": f"2027 VS CAPI {o}", "cycle": "2027 VS",
              "series": "CAPI", "round": int(o[1:]), "dataset_id": f"2027 VS CAPI {o}",
              "version": "normal", "fallback": False, "seats": 403, "borrowed": 0,
              "seats_source": "metadata"} for o in order]
    groups = [{"cycle": "2027 VS", "series": "CAPI", "obs_ids": order}]
    return TranslateContext(
        card_id=card_id, state=STATE,
        rounds={"items": items, "groups": groups, "anchor": anchor, "compare": compare},
        round_order=order, labels={o: o for o in order}, anchor=anchor, compare=compare,
        rules=load_rules(ROOT / "config" / "presentation"), rules_version="fixture",
        engine_version="0.8.0", metadata_revision=1, alliance_epoch=0)


def build_payload(name: str) -> dict:
    sample, fields, anchor, compare = FIXTURES[name]
    result = load_sample(sample)
    config = CardConfig.model_validate(
        {"id": f"fixture.{name}", "section": "fixture", "title": name, **fields})
    context = _context(config.id, result, anchor, compare)
    payload = translate_grid(config, get_family(config.family), result, context)
    return payload.model_dump()


def export_fixtures(out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for name in FIXTURES:
        path = out_dir / f"{name}.json"
        path.write_text(json.dumps(build_payload(name), ensure_ascii=False, sort_keys=True,
                                   separators=(",", ":")), encoding="utf-8")
        paths.append(path)
    return paths


if __name__ == "__main__":
    for written in export_fixtures(FIXTURES_DIR):
        print(f"wrote {written.relative_to(ROOT)} ({written.stat().st_size // 1024} KB)")
