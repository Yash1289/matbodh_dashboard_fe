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
    assert [j.part for j in plan.jobs] == ["vote", "parties", "seats_ac", "seats_pc"]
    assert len({j.key for j in plan.jobs}) == 4
    assert plan.anchor == R2 and plan.compare == R1
    vote, parties, ac, pc = plan.jobs
    assert vote.kind == "analysis" and vote.config["request"]["gender_differential"]
    assert vote.config["request"]["comparisons"][0]["target"] == ["o2", "vs_voting_intention"]
    assert vote.config["request"]["parties"]["other_grouping"] == {
        "keep": ["NDA", "SP+", "BSP"], "label": "Other"}
    assert ac.kind == "benchmark" and ac.contenders_from == "parties"
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


def test_scoreboard_parties_job_is_the_vote_request_without_other_grouping():
    """Benchmarks need every party as a contender; the grouped vote job folds
    non-kept parties into Other (engine party_grouping), so contenders come
    from an ungrouped job over the same rounds and scenario."""
    plan = _plan("pulse.party_scoreboard", _ctx([R1, R2], compare_round=R1))
    vote, parties = plan.jobs[0], plan.jobs[1]
    assert (parties.key, parties.kind, parties.part) == ("parties", "analysis", "parties")
    v, p = vote.config["request"], parties.config["request"]
    assert p["parties"]["other_grouping"] is None
    assert p["comparisons"] == [] and p["gender_differential"] is None
    for key in ("observations", "scenarios", "grouping_sets", "coverage_mode", "weights"):
        assert p[key] == v[key]
    assert parties.contenders_from is None


def test_scoreboard_three_rounds_adds_single_benchmarks():
    plan = _plan("pulse.party_scoreboard", _ctx([R1, R2, R3], compare_round=R2))
    assert plan.anchor == R3
    assert len(plan.jobs) == 6
    singles = [j for j in plan.jobs if j.config.get("benchmark", {}).get("reference") is None
               and j.kind == "benchmark"]
    assert {(j.part, j.config["benchmark"]["target"]["observation"]) for j in singles} == {
        ("seats_ac", "o1"), ("seats_pc", "o1")}
    for j in singles:
        assert [o["id"] for o in j.config["request"]["observations"]] == ["o1"]
        assert j.contenders_from == "parties"
    assert len({j.key for j in plan.jobs}) == 6


def test_scoreboard_without_compare_has_no_comparison_and_single_benchmarks():
    plan = _plan("pulse.party_scoreboard", _ctx([R1, R2]))
    assert plan.compare is None
    vote = plan.jobs[0]
    assert vote.config["request"]["comparisons"] == []
    benches = [j for j in plan.jobs if j.kind == "benchmark"]
    assert len(benches) == 4  # (ac, pc) x (o1, o2)
    assert all(j.config["benchmark"]["reference"] is None for j in benches)
    assert {j.config["benchmark"]["target"]["observation"] for j in benches} == {"o1", "o2"}
    assert len({j.key for j in plan.jobs}) == 6


def test_scoreboard_pc_level_has_no_ac_seats():
    plan = _plan("pulse.party_scoreboard", _ctx([R1, R2], level="pc", compare_round=R1))
    assert [j.part for j in plan.jobs] == ["vote", "parties", "seats_pc"]
    assert plan.unavailable == ()


def test_scoreboard_state_level_marks_seats_unavailable():
    plan = _plan("pulse.party_scoreboard", _ctx([R1, R2], level="state", compare_round=R1))
    assert [j.part for j in plan.jobs] == ["vote"]  # no seat views: no contenders needed
    reason = "Seat views need an AC or PC level survey"
    assert plan.unavailable == (("seats_ac", reason), ("seats_pc", reason))


def test_opinion_uses_net_score():
    plan = _plan("pulse.leaders", _ctx([R1, R2], compare_round=R1))
    # R1 did not ask cm_satisfaction: one job per distinct round set.
    assert [j.part for j in plan.jobs] == ["opinion", "opinion"]
    assert [j.key for j in plan.jobs] == ["opinion_1", "opinion_2"]
    both, r2_only = (j.config["request"] for j in plan.jobs)
    assert both["comparisons"][0]["measure"] == "net_score"
    assert both["scenarios"] == ["pm_satisfaction", "state_govt_satisfaction",
                                 "central_govt_satisfaction"]
    assert r2_only["scenarios"] == ["cm_satisfaction"]
    assert r2_only["comparisons"] == []  # compare round R1 did not ask it
    assert plan.not_asked == (("cm_satisfaction", (R1,)),)


def test_by_zone_grouping_and_common_coverage():
    plan = _plan("pulse.by_zone", _ctx([R1, R2], compare_round=R1))
    assert [j.part for j in plan.jobs] == ["zone"]
    request = plan.jobs[0].config["request"]
    assert request["grouping_sets"] == [[], ["party_zone"]]
    assert request["coverage_mode"] == "common"  # different seat sets, geographic


def test_bind_contenders_excludes_nota_and_other():
    job = _plan("pulse.party_scoreboard", _ctx([R1, R2], compare_round=R1)).jobs[2]
    bound = bind_contenders(job, ["NDA", "SP+", "BSP", "JDL", "NOTA", "Other"], PRESET)
    assert bound.config["benchmark"]["contenders"] == ["BSP", "JDL", "NDA", "SP+"]
    assert job.config["benchmark"]["contenders"] == []
    assert bound.key == job.key


# -- per-round availability (a round that did not ask a question) ----------

R4 = "2027 VS CAPI R4"
OPINION = ["pm_satisfaction", "cm_satisfaction", "state_govt_satisfaction",
           "central_govt_satisfaction"]


def _availability_catalogue(**overrides):
    """R1..R3 at AC level. Per round: (scenarios, fields) overrides."""
    base_scenarios = ["vs_voting_intention", *OPINION, "state_govt_change"]
    base_fields = ["age", "gender", "ac_num", "pc_num"]
    rows, levels = [], []
    for i, name in enumerate([R1, R2, R3], 1):
        scenarios, fields = overrides.get(name, (base_scenarios, base_fields))
        rows.append(dataset_row(name, round_number=i, available_scenarios=scenarios,
                                available_fields=fields))
        levels.append(level_row(name, range(1, 404)))
    return load_catalogue(make_query(rows, levels))


def _plan_with(tid, ctx, catalogue):
    return plan_card(TEMPLATES[tid], ctx, catalogue, PRESET)


def _ids(request):
    return [o["id"] for o in request["observations"]]


def test_opinion_question_missing_in_one_round_is_split_not_failed():
    no_cm = [s for s in ["vs_voting_intention", *OPINION] if s != "cm_satisfaction"]
    cat = _availability_catalogue(**{R1: (no_cm, ["gender"])})
    plan = _plan_with("pulse.leaders", _ctx([R1, R2, R3], compare_round=R2), cat)
    by_scenarios = {tuple(j.config["request"]["scenarios"]): j for j in plan.jobs}
    assert set(by_scenarios) == {
        ("pm_satisfaction", "state_govt_satisfaction", "central_govt_satisfaction"),
        ("cm_satisfaction",)}
    full = by_scenarios[("pm_satisfaction", "state_govt_satisfaction",
                         "central_govt_satisfaction")]
    cm = by_scenarios[("cm_satisfaction",)]
    # Global obs ids are kept so cells line up across jobs.
    assert _ids(full.config["request"]) == ["o1", "o2", "o3"]
    assert _ids(cm.config["request"]) == ["o2", "o3"]
    assert {j.part for j in plan.jobs} == {"opinion"}
    assert len({j.key for j in plan.jobs}) == 2
    assert plan.not_asked == (("cm_satisfaction", (R1,)),)
    assert plan.unavailable == ()
    # Anchor R3 vs compare R2 both asked cm_satisfaction: comparison kept.
    assert [c["target"] for c in cm.config["request"]["comparisons"]] == [
        ["o3", "cm_satisfaction"]]


def test_comparison_only_when_anchor_and_compare_both_asked():
    no_cm = ["vs_voting_intention", "pm_satisfaction"]
    cat = _availability_catalogue(**{R1: (no_cm, ["gender"])})
    plan = _plan_with("pulse.leaders", _ctx([R1, R2, R3], compare_round=R1), cat)
    by_first = {j.config["request"]["scenarios"][0]: j for j in plan.jobs}
    pm = by_first["pm_satisfaction"].config["request"]
    assert [c["target"] for c in pm["comparisons"]] == [["o3", "pm_satisfaction"]]
    cm = by_first["cm_satisfaction"].config["request"]
    assert cm["comparisons"] == []  # R1 (compare) did not ask cm_satisfaction
    assert _ids(cm) == ["o2", "o3"]


def test_question_asked_by_no_selected_round_is_unavailable():
    no_central = [s for s in ["vs_voting_intention", *OPINION]
                  if s != "central_govt_satisfaction"]
    cat = _availability_catalogue(**{R1: (no_central, ["gender"]),
                                     R2: (no_central, ["gender"])})
    plan = _plan_with("pulse.leaders", _ctx([R1, R2], compare_round=R1), cat)
    assert all("central_govt_satisfaction" not in j.config["request"]["scenarios"]
               for j in plan.jobs)
    (part, reason), = plan.unavailable
    assert part == "central_govt_satisfaction"
    assert R1 in reason and R2 in reason
    assert plan.not_asked == ()


def test_scoreboard_round_without_vote_question_is_not_asked():
    cat = _availability_catalogue(**{R1: (OPINION, ["gender"])})
    plan = _plan_with("pulse.party_scoreboard", _ctx([R1, R2, R3], compare_round=R1), cat)
    vote = plan.jobs[0].config["request"]
    assert _ids(vote) == ["o2", "o3"]
    assert vote["comparisons"] == []  # compare round R1 did not ask the question
    assert _ids(plan.jobs[1].config["request"]) == ["o2", "o3"]
    benches = [j for j in plan.jobs if j.kind == "benchmark"]
    targets = {(j.part, j.config["benchmark"]["target"]["id"],
                (j.config["benchmark"]["reference"] or {}).get("id")) for j in benches}
    assert targets == {("seats_ac", "o2", None), ("seats_ac", "o3", None),
                       ("seats_pc", "o2", None), ("seats_pc", "o3", None)}
    for j in benches:
        assert _ids(j.config["request"]) == [j.config["benchmark"]["target"]["id"]]
    assert set(plan.not_asked) == {(p, (R1,)) for p in
                                   ("vote", "gender_gap", "seats_ac", "seats_pc")}


def test_gender_gap_only_when_every_included_round_has_gender():
    cat = _availability_catalogue(**{R1: (["vs_voting_intention"], ["age"])})
    plan = _plan_with("pulse.party_scoreboard", _ctx([R1, R2], compare_round=R1), cat)
    assert plan.jobs[0].config["request"]["gender_differential"] is None
    (part, reason), = plan.unavailable
    assert part == "gender_gap" and R1 in reason and R2 not in reason
    assert "gender" in reason


def test_scoreboard_with_no_round_asking_the_vote_question():
    cat = _availability_catalogue(**{R1: (OPINION, ["gender"]), R2: (OPINION, ["gender"])})
    plan = _plan_with("pulse.party_scoreboard", _ctx([R1, R2], compare_round=R1), cat)
    assert plan.jobs == ()
    assert {p for p, _ in plan.unavailable} == {"vote", "gender_gap", "seats_ac", "seats_pc"}


def test_by_zone_split_by_round_and_master_slice_field_available():
    # party_zone is an engine master attribute (catalog.default_fields): the
    # metadata session adds it to every observation, so it is never "missing".
    cat = _availability_catalogue(**{R1: (OPINION, ["gender"])})
    plan = _plan_with("pulse.by_zone", _ctx([R1, R2, R3], compare_round=R2), cat)
    (zone,) = plan.jobs
    assert _ids(zone.config["request"]) == ["o2", "o3"]
    assert plan.not_asked == (("zone", (R1,)),)
    assert plan.unavailable == ()


def test_by_zone_respondent_slice_field_missing_marks_part_unavailable():
    template = TEMPLATES["pulse.by_zone"].model_copy(update={"slices": ["age"]})
    cat = _availability_catalogue(**{R2: (["vs_voting_intention"], ["gender"])})
    plan = plan_card(template, _ctx([R1, R2], compare_round=R1), cat, PRESET)
    assert plan.jobs == ()
    (part, reason), = plan.unavailable
    assert part == "zone" and "age" in reason and R2 in reason


# -- template requirements and level capabilities ----------------------------


def test_by_zone_on_pc_level_is_unavailable_with_reason():
    plan = _plan("pulse.by_zone", _ctx([R1, R2], level="pc", compare_round=R1))
    assert plan.jobs == ()
    reasons = dict(plan.unavailable)
    assert set(reasons) == {"zone"}
    assert "AC-level" in reasons["zone"] and "party_zone" in reasons["zone"]


def test_by_zone_on_state_level_is_unavailable_with_reason():
    plan = _plan("pulse.by_zone", _ctx([R1, R2], level="state", compare_round=R1))
    assert plan.jobs == ()
    (part, reason), = plan.unavailable
    assert part == "zone" and "AC-level" in reason


def test_geo_slice_outside_level_capabilities_is_unavailable():
    # min_level is met (state), but the slice is not a PC-level geographic slice.
    template = TEMPLATES["pulse.by_zone"].model_copy(
        update={"requires": TEMPLATES["pulse.leaders"].requires, "slices": ["district"]})
    plan = plan_card(template, _ctx([R1, R2], level="pc", compare_round=R1),
                     _catalogue("pc"), PRESET)
    assert plan.jobs == ()
    (part, reason), = plan.unavailable
    assert part == "zone" and "district" in reason and "PC" in reason


def test_demographic_slice_is_not_a_geographic_restriction():
    template = TEMPLATES["pulse.by_zone"].model_copy(
        update={"requires": TEMPLATES["pulse.leaders"].requires, "slices": ["age"]})
    plan = plan_card(template, _ctx([R1, R2], level="state", compare_round=R1),
                     _catalogue("state"), PRESET)
    assert [j.part for j in plan.jobs] == ["zone"] and plan.unavailable == ()
