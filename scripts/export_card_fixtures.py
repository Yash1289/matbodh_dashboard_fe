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


def payload_from_result(result: dict, name: str, fields: dict, anchor: str,
                        compare: str | None) -> dict:
    """Translate one engine result into a card payload with the real translator."""
    config = CardConfig.model_validate(
        {"id": f"fixture.{name}", "section": "fixture", "title": name, **fields})
    context = _context(config.id, result, anchor, compare)
    payload = translate_grid(config, get_family(config.family), result, context)
    return payload.model_dump()


def build_payload(name: str) -> dict:
    sample, fields, anchor, compare = FIXTURES[name]
    return payload_from_result(load_sample(sample), name, fields, anchor, compare)


RANKED_FIXTURES = ("ranked_seat_standalone", "ranked_seat_trend", "ranked_demographic_standalone")


class _FixtureLabels:
    """Synthetic seat names so the frontend tests exercise the label path; not master data."""

    def labels(self, state, level, seat_ids):
        return {i: {"name": f"Seat {i}", "zone": "Fixture zone"} for i in seat_ids}


def build_ranked_payload(name: str) -> dict:
    """Translate ranking samples with the real translator.

    The trend fixture's earlier round is a synthetic variant of the R2 sample (only R2
    ranking samples exist); its contract says so.
    """
    from matbodh_dashboard.cards.ranking.translate import translate_ranked
    from tests.cards.ranking_helpers import demographic_card, ranked_ctx, seat_card, variant

    card_id = f"fixture.{name}"
    labels = None
    if name == "ranked_demographic_standalone":
        card = demographic_card(id=card_id)
        results, obs = {"o2": load_sample("result_seat_rank_demograph.json")}, ["o2"]
    else:
        sample = load_sample("result_rank.json")
        labels = _FixtureLabels()
        if name == "ranked_seat_trend":
            card = seat_card(id=card_id, comparison={"mode": "trend"})
            later = variant(sample, drop_seats=("128",))
            later["contract"] = {"synthetic_later_round": True}
            results, obs = {"o2": sample, "o1": later}, ["o1", "o2"]
        else:
            card, results, obs = seat_card(id=card_id), {"o2": sample}, ["o2"]
    return translate_ranked(card, results, ranked_ctx(card_id, obs, "o2"),
                            labels=labels).model_dump()


BENCHMARK_FIXTURES = ("benchmark_survey_vs_2022",)


def build_benchmark_payload(name: str) -> dict:
    """The live UP result (survey R2 vs the 2022 VS election, Other rows) through the real translator."""
    from matbodh_dashboard.cards.benchmark.translate import translate_benchmark
    from matbodh_dashboard.cards.config import CardConfig
    from tests.cards.benchmark_helpers import (
        FIXTURE_ENDPOINT_IDS, FIXTURE_MAJORS, load_benchmark_sample)
    from tests.cards.ranking_helpers import ranked_ctx

    card_id = f"fixture.{name}"
    card = CardConfig.model_validate({
        "id": card_id, "family": "seat_benchmark", "section": "benchmarks", "title": "T",
        "scenarios": ["vs_voting_intention"], "view": {"table": "comparison"},
        "benchmark": {"focal_party": "NDA", "grouping_sets": [[], ["party_zone"]]}})
    job = {"request": {"parties": {"other_grouping": {"keep": list(FIXTURE_MAJORS), "label": "Other"}}},
           "benchmark": {
               "contenders": list(FIXTURE_MAJORS), "focal_party": "NDA",
               "target": {"source": "survey", "id": FIXTURE_ENDPOINT_IDS["target"],
                          "observation": "o2", "scenario": "vs_voting_intention"},
               "reference": {"source": "election", "id": FIXTURE_ENDPOINT_IDS["reference"],
                             "context": {"year": 2022, "election_type": "VS"}}}}
    majors = frozenset(FIXTURE_MAJORS)
    return translate_benchmark(card, load_benchmark_sample(), job,
                               {"target": majors, "reference": majors},
                               ranked_ctx(card_id, ["o2"], "o2")).model_dump()


def export_fixtures(out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    builders = ([(n, build_payload) for n in FIXTURES] + [(n, build_ranked_payload)
                                                           for n in RANKED_FIXTURES]
                + [(n, build_benchmark_payload) for n in BENCHMARK_FIXTURES])
    for name, build in builders:
        path = out_dir / f"{name}.json"
        path.write_text(json.dumps(build(name), ensure_ascii=False, sort_keys=True,
                                   separators=(",", ":")), encoding="utf-8")
        paths.append(path)
    return paths


if __name__ == "__main__":
    for written in export_fixtures(FIXTURES_DIR):
        print(f"wrote {written.relative_to(ROOT)} ({written.stat().st_size // 1024} KB)")
