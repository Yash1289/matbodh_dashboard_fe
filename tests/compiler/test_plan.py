from dataclasses import replace
from pathlib import Path

from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.compiler.plan import bind_contenders, plan_card
from matbodh_dashboard.context import StateContext
from matbodh_dashboard.presets import load_preset
from matbodh_dashboard.templates import load_templates
from tests.fixtures.catalogue_rows import DATASET_ROWS, LEVEL_ROWS, dataset_row, level_row, make_query

ROOT = Path(__file__).resolve().parents[2]
PRESET = load_preset(ROOT / "config/presets/uttar-pradesh.standard-v1.yaml")
TEMPLATES = load_templates(ROOT / "config/templates/pulse.yaml")
STATE = "Uttar Pradesh"
R1, R2, R3 = "2027 VS CAPI R1", "2027 VS CAPI R2", "2027 VS CAPI R3"


def _catalogue(level="ac"):
    rows = list(DATASET_ROWS) + [dataset_row(R3, round_number=3, revision=7, level=level)]
    lv = list(LEVEL_ROWS) + [level_row(R3, range(1, 404))]
    if level != "ac":
        rows = [dataset_row(n, round_number=i, level=level) for i, n in enumerate([R1, R2, R3], 1)]
        lv = [level_row(n, range(1, 404)) for n in (R1, R2, R3)]
    return load_catalogue(make_query(rows, lv))


def _ctx(rounds, level="ac", **kw):
    return StateContext(state=STATE, level=level, rounds=rounds, **kw)


def _plan(tid, ctx):
    return plan_card(TEMPLATES[tid], ctx, _catalogue(ctx.level), PRESET)


def test_scoreboard_two_rounds_ac():
    plan = _plan("pulse.party_scoreboard", _ctx([R1, R2], compare_round=R1))
    assert [j.part for j in plan.jobs] == ["vote", "seats_ac", "seats_pc"]
    assert len({j.key for j in plan.jobs}) == 3
    assert plan.anchor == R2 and plan.compare == R1
    vote, ac, pc = plan.jobs
    assert vote.kind == "analysis" and vote.config["request"]["gender_differential"]
    assert vote.config["request"]["comparisons"][0]["target"] == ["o2", "vs_voting_intention"]
    assert ac.kind == "benchmark" and ac.contenders_from == "vote"
    b = ac.config["benchmark"]
    assert b == {
        "id": ac.key, "seat_level": "ac",
        "target": {"source": "survey", "id": "o2", "observation": "o2",
                   "scenario": "vs_voting_intention"},
        "reference": {"source": "survey", "id": "o1", "observation": "o1",
                      "scenario": "vs_voting_intention"},
        "contenders": [], "focal_party": None, "grouping_sets": [[]],
        "filters": [], "seat_ids": []}
    assert pc.config["benchmark"]["seat_level"] == "pc"
    req = ac.config["request"]
    assert [o["id"] for o in req["observations"]] == ["o1", "o2"]
    assert req["parties"]["other_grouping"] is None
    assert req["comparisons"] == [] and req["gender_differential"] is None
    assert plan.unavailable == ()


def test_scoreboard_three_rounds_adds_single_benchmarks():
    plan = _plan("pulse.party_scoreboard", _ctx([R1, R2, R3], compare_round=R2))
    assert plan.anchor == R3
    assert len(plan.jobs) == 5
    singles = [j for j in plan.jobs if j.config.get("benchmark", {}).get("reference") is None
               and j.kind == "benchmark"]
    assert {(j.part, j.config["benchmark"]["target"]["observation"]) for j in singles} == {
        ("seats_ac", "o1"), ("seats_pc", "o1")}
    for j in singles:
        assert [o["id"] for o in j.config["request"]["observations"]] == ["o1"]
        assert j.contenders_from == "vote"
    assert len({j.key for j in plan.jobs}) == 5


def test_scoreboard_without_compare_has_no_comparison_and_single_benchmarks():
    plan = _plan("pulse.party_scoreboard", _ctx([R1, R2]))
    assert plan.compare is None
    vote = plan.jobs[0]
    assert vote.config["request"]["comparisons"] == []
    benches = [j for j in plan.jobs if j.kind == "benchmark"]
    assert len(benches) == 4  # (ac, pc) x (o1, o2)
    assert all(j.config["benchmark"]["reference"] is None for j in benches)
    assert {j.config["benchmark"]["target"]["observation"] for j in benches} == {"o1", "o2"}
    assert len({j.key for j in plan.jobs}) == 5


def test_scoreboard_pc_level_has_no_ac_seats():
    plan = _plan("pulse.party_scoreboard", _ctx([R1, R2], level="pc", compare_round=R1))
    assert [j.part for j in plan.jobs] == ["vote", "seats_pc"]
    assert plan.unavailable == ()


def test_scoreboard_state_level_marks_seats_unavailable():
    plan = _plan("pulse.party_scoreboard", _ctx([R1, R2], level="state", compare_round=R1))
    assert [j.part for j in plan.jobs] == ["vote"]
    reason = "Seat views need an AC or PC level survey"
    assert plan.unavailable == (("seats_ac", reason), ("seats_pc", reason))


def test_opinion_uses_net_score():
    plan = _plan("pulse.leaders", _ctx([R1, R2], compare_round=R1))
    assert [j.part for j in plan.jobs] == ["opinion"]
    request = plan.jobs[0].config["request"]
    assert request["comparisons"][0]["measure"] == "net_score"
    assert request["scenarios"] == TEMPLATES["pulse.leaders"].questions


def test_by_zone_grouping_and_common_coverage():
    plan = _plan("pulse.by_zone", _ctx([R1, R2], compare_round=R1))
    assert [j.part for j in plan.jobs] == ["zone"]
    request = plan.jobs[0].config["request"]
    assert request["grouping_sets"] == [[], ["party_zone"]]
    assert request["coverage_mode"] == "common"  # different seat sets, geographic


def test_bind_contenders_excludes_nota_and_other():
    job = _plan("pulse.party_scoreboard", _ctx([R1, R2], compare_round=R1)).jobs[1]
    bound = bind_contenders(job, ["NDA", "SP+", "BSP", "JDL", "NOTA", "Other"], PRESET)
    assert bound.config["benchmark"]["contenders"] == ["BSP", "JDL", "NDA", "SP+"]
    assert job.config["benchmark"]["contenders"] == []
    assert bound.key == job.key
