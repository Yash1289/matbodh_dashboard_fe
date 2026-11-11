from pathlib import Path

from matbodh_dashboard.cards.compile import compile_card
from matbodh_dashboard.cards.config import CardConfig
from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import load_preset
from tests.fixtures.catalogue_rows import SCENARIOS, dataset_row, level_row, make_query

ROOT = Path(__file__).resolve().parents[2]
PRESET = load_preset(ROOT / "config/presets/uttar-pradesh.standard-v1.yaml")
STATE = "Uttar Pradesh"
R1, R2, R3 = (f"2027 VS CAPI R{i}" for i in (1, 2, 3))
FIELDS = ["age_group", "gender", "ac_num", "pc_num", "party_zone", "category", "caste"]
VS, LS, PM, CM = "vs_voting_intention", "ls_past", "pm_satisfaction", "cm_satisfaction"


def _catalogue(level="ac", rounds=3):
    rows, levels = [], []
    for i in range(1, rounds + 1):
        name = f"2027 VS CAPI R{i}"
        scenarios = [s for s in [*SCENARIOS, LS] if i > 1 or s != CM]  # R1 did not ask CM
        rows.append(dataset_row(name, round_number=i, level=level, available_fields=FIELDS,
                                available_scenarios=scenarios))
        levels.append(level_row(name, range(1, 381 if i == 1 else 404)))
    return load_catalogue(make_query(rows, levels))


def _ctx(rounds=(R1, R2, R3), level="ac", compare=R1):
    return StateContext(state=STATE, level=level, rounds=list(rounds), compare_round=compare)


def _seat(rank=None, **overrides) -> CardConfig:
    data = {"id": "ranking.seat", "family": "seat_ranking", "section": "rankings", "title": "T",
            "scenarios": [PM], "rank": {"metric": "net_score", "level": "ac", **(rank or {})}}
    data.update(overrides)
    return CardConfig.model_validate(data)


def _demographic(**overrides) -> CardConfig:
    data = {"id": "ranking.demo", "family": "demographic_ranking", "section": "rankings",
            "title": "T", "scenarios": [VS],
            "rank": {"metric": "support_share", "party_id": "NDA", "level": "caste",
                     "partition_by": ["ac_num"], "top_k": 3}}
    data.update(overrides)
    return CardConfig.model_validate(data)


def _compile(config, ctx=None, level="ac"):
    return compile_card(config, ctx or _ctx(level=level), _catalogue(level), PRESET)


def test_standalone_seat_card_is_one_job():
    plan = _compile(_seat())
    assert plan.unavailable == ()
    (job,) = plan.jobs
    assert (job.key, job.part, job.kind) == ("rank", "grid", "analysis")
    request, ranking = job.config["request"], job.config["ranking"]
    assert request["observations"] == [{"id": "o3", "survey_name": R3}]
    assert request["scenarios"] == [PM] and request["grouping_sets"] == []
    assert request["filters"] == [] and request["comparisons"] == []
    assert request["coverage_mode"] == "independent" and request["caste_clubbing"] is None
    assert ranking["seat_level"] == "ac" and ranking["universe_snapshot"] == "ac_roster"
    assert ranking["target"] == ["o3", PM] and ranking["measure"] == "net_score"
    assert ranking["top_k"] is None and ranking["membership_snapshot"] is None
    assert ranking["comparison_id"] is None and ranking["seat_ids"] == []


def test_pc_ranking_from_an_ac_survey_adds_membership():
    (job,) = _compile(_seat(rank={"level": "pc"})).jobs
    ranking = job.config["ranking"]
    assert (ranking["seat_level"], ranking["universe_snapshot"]) == ("pc", "pc_roster")
    assert ranking["membership_snapshot"] == "ac_pc"


def test_pc_ranking_on_a_pc_survey_needs_no_membership():
    (job,) = _compile(_seat(rank={"level": "pc"}), level="pc").jobs
    assert job.config["ranking"]["membership_snapshot"] is None


def test_ac_ranking_on_a_pc_survey_is_unavailable():
    plan = _compile(_seat(), level="pc")
    assert plan.jobs == ()
    assert any("AC" in reason for _, reason in plan.unavailable)


def test_trend_emits_one_job_per_asked_round():
    plan = _compile(_seat(comparison={"mode": "trend"}))
    assert [j.key for j in plan.jobs] == ["rank:o1", "rank:o2", "rank:o3"]
    for job in plan.jobs:
        obs = job.key.split(":")[1]
        assert [o["id"] for o in job.config["request"]["observations"]] == [obs]
        assert job.config["ranking"]["target"] == [obs, PM]
    policies = {str({k: v for k, v in j.config["request"].items() if k != "observations"})
                for j in plan.jobs}
    assert len(policies) == 1


def test_trend_skips_rounds_that_did_not_ask_the_scenario():
    plan = _compile(_seat(scenarios=[CM], comparison={"mode": "trend"}))
    assert [j.key for j in plan.jobs] == ["rank:o2", "rank:o3"]
    assert plan.not_asked == (("grid", (R1,)),)


def test_compare_is_one_job_with_the_engine_comparison():
    card = _seat(scenarios=[], comparison={
        "mode": "compare", "target": {"scenario": PM},
        "reference": {"round": "compare", "scenario": PM}})
    plan = _compile(card)
    (job,) = plan.jobs
    request, ranking = job.config["request"], job.config["ranking"]
    assert [o["id"] for o in request["observations"]] == ["o1", "o3"]
    (comparison,) = request["comparisons"]
    assert comparison["target"] == ["o3", PM] and comparison["reference"] == ["o1", PM]
    assert ranking["comparison_id"] == comparison["id"] and ranking["target"] is None


def test_demographic_ranking_shape():
    card = _demographic(filters=[{"field": "gender", "values": ["Female"]}])
    (job,) = _compile(card).jobs
    ranking, request = job.config["ranking"], job.config["request"]
    assert ranking["level"] == "caste" and ranking["partition_by"] == ["ac_num"]
    assert ranking["top_k"] == 3 and ranking["party_id"] == "NDA"
    assert "seat_level" not in ranking and "universe_snapshot" not in ranking
    assert request["filters"] == [{"field": "gender", "operator": "in", "values": ["Female"]}]


def test_scenario_not_asked_in_the_anchor_round_is_unavailable_with_no_jobs():
    plan = _compile(_seat(scenarios=[CM]), ctx=_ctx(rounds=(R1,), compare=None))
    assert plan.jobs == ()
    assert any("not asked" in reason for _, reason in plan.unavailable)


def test_seeded_pc_card_is_available_on_a_pc_designed_survey():
    from matbodh_dashboard.cards.config import load_cards

    card = load_cards(ROOT / "config/cards/cards.yaml")["ranking.pc_pm_net"]
    plan = _compile(card, level="pc")
    assert plan.unavailable == () and [j.key for j in plan.jobs] == ["rank"]


def test_party_outside_the_preset_keep_list_is_unavailable_not_silently_zero():
    # Parties outside `keep` fold into Other, so the engine would rank the focal party at 0
    # in every seat; the card must say so instead (final review).
    card = _demographic(rank={"metric": "support_share", "party_id": "BJP+", "level": "caste",
                              "partition_by": ["ac_num"], "top_k": 3})
    plan = _compile(card)
    assert plan.jobs == ()
    assert any("BJP+" in reason and "NDA" in reason for _, reason in plan.unavailable)


def test_compare_over_rounds_with_different_seat_coverage_uses_common_coverage():
    # R1 covers 380 ACs, R3 403: the grid compare already switches to common coverage, and
    # the engine's ranking raises on mismatched coverage otherwise (final review).
    card = _seat(scenarios=[], comparison={
        "mode": "compare", "target": {"scenario": PM},
        "reference": {"round": "compare", "scenario": PM}})
    (job,) = _compile(card).jobs
    request = job.config["request"]
    assert request["coverage_mode"] == "common" and request["reference_observation"] == "o1"
