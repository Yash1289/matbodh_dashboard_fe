import pytest

from matbodh_dashboard.cards.benchmark.reference import BenchmarkReference
from matbodh_dashboard.cards.cohort.compile import SelectionPredicate, compile_cohort_selection
from matbodh_dashboard.catalogue.store import load_catalogue
from tests.cards import test_benchmark_compile as bench
from tests.cards import test_ranking_compile as rank
from tests.fixtures.catalogue_rows import SCENARIOS, dataset_row, level_row, make_query

PARTY = {"vs_voting_intention", "vs_past", "ls_past"}


def rank_selection(config, predicate=None, ctx=None):
    return compile_cohort_selection(config, ctx or rank._ctx(), rank._catalogue(), rank.PRESET,
                                    predicate or SelectionPredicate(rank_max=5))


def bench_selection(predicate, reference=None, card=None):
    return compile_cohort_selection(card or bench._card(), bench._ctx(), bench._catalogue(), bench.PRESET,
                                    predicate, reference=reference, parties=bench.FakeParties(),
                                    elections=bench.ELECTIONS)


def only_job(plan):
    assert plan.unavailable == (), plan.unavailable
    (job,) = plan.jobs
    assert (job.kind, job.part) == ("selection", "grid")
    return job.config


def test_trend_ranking_uses_the_anchor_rounds_job():
    config = only_job(rank_selection(rank._seat(comparison={"mode": "trend"})))
    assert config["ranking"]["target"] == ["o3", rank.PM]
    assert [o["id"] for o in config["selection"]["source_request"]["observations"]] == ["o3"]


def test_compare_ranking_keeps_its_comparison_in_the_source_request():
    card = rank._seat(scenarios=[], comparison={"mode": "compare", "target": {"scenario": rank.PM},
                                                "reference": {"round": "compare", "scenario": rank.PM}})
    config = only_job(rank_selection(card))
    source = config["selection"]["source_request"]
    assert len(source["comparisons"]) == 1 and config["ranking"]["comparison_id"] == source["comparisons"][0]["id"]
    assert config["request"]["comparisons"] == []


def test_downstream_is_overall_anchor_party_scenarios_only():
    config = only_job(rank_selection(rank._seat()))
    request = config["request"]
    assert [o["id"] for o in request["observations"]] == ["o3"]
    assert request["grouping_sets"] == [[]]
    assert request["filters"] == [] and request["comparisons"] == [] and request["caste_clubbing"] is None
    assert request["gender_differential"] is None
    assert request["scenarios"] and set(request["scenarios"]) <= PARTY
    assert request["scenarios"] == sorted(request["scenarios"])


def test_a_scenario_not_in_the_anchor_dataset_or_not_a_party_one_is_never_added():
    # The anchor round asked only an opinion scenario and a scenario unknown to the catalogue.
    rows = [dataset_row(f"2027 VS CAPI R{i}", round_number=i, available_fields=rank.FIELDS,
                        available_scenarios=([rank.PM, "made_up_scenario"] if i == 3 else list(SCENARIOS)))
            for i in (1, 2, 3)]
    levels = [level_row(f"2027 VS CAPI R{i}", range(1, 404)) for i in (1, 2, 3)]
    catalogue = load_catalogue(make_query(rows, levels))
    plan = compile_cohort_selection(rank._seat(), rank._ctx(), catalogue, rank.PRESET, SelectionPredicate(rank_max=5))
    assert plan.jobs == () and any("party scenario" in r for _, r in plan.unavailable)


def test_demographic_ranking_has_no_selection():
    plan = rank_selection(rank._demographic())
    assert plan.jobs == () and any("demographic" in r.lower() for _, r in plan.unavailable)


def test_other_families_have_no_selection():
    from tests.cards import test_compile as grid

    plan = compile_cohort_selection(grid._config(), grid._ctx(), grid._catalogue(), grid.PRESET,
                                    SelectionPredicate(rank_max=5))
    assert plan.jobs == () and plan.unavailable


def test_rank_max_per_partition_and_bounds_are_passed_through():
    predicate = SelectionPredicate(rank_max=3, metric_min=1.5, metric_max=9, upper_inclusive=True)
    selection = only_job(rank_selection(rank._seat(rank={"partition_by": ["party_zone"]}), predicate))["selection"]
    assert selection["rank_max"] == 3 and selection["metric_min"] == 1.5 and selection["metric_max"] == 9
    assert selection["upper_inclusive"] is True and selection["lower_inclusive"] is True
    assert "margin_min" not in selection and "flip" not in selection


def test_benchmark_selection_carries_endpoint_margin_and_status():
    predicate = SelectionPredicate(endpoint="target", status="losing", margin_min=-13, margin_max=-3)
    config = only_job(bench_selection(predicate, BenchmarkReference(kind="compare")))
    assert config["benchmark"]["target"]["id"] == "target"
    selection = config["selection"]
    assert (selection["endpoint"], selection["status"], selection["margin_min"], selection["margin_max"]) == (
        "target", "losing", -13, -3)
    assert "rank_max" not in selection and selection["source_request"] is not None


def test_flip_without_a_reference_is_unavailable():
    plan = bench_selection(SelectionPredicate(flip="gain"), BenchmarkReference(kind="none"))
    assert plan.jobs == () and any("reference" in r for _, r in plan.unavailable)
    config = only_job(bench_selection(SelectionPredicate(flip="gain", endpoint="target"),
                                      BenchmarkReference(kind="compare")))
    assert config["selection"]["flip"] == "gain"


def test_benchmark_without_a_focal_party_is_unavailable():
    plan = bench_selection(SelectionPredicate(status="winning"), BenchmarkReference(kind="compare"),
                           card=bench._card(focal=None))
    assert plan.jobs == () and any("focal" in r for _, r in plan.unavailable)


def test_a_card_that_is_itself_unavailable_reports_its_reasons():
    plan = rank_selection(rank._seat(rank={"party_id": "Nope", "metric": "support_share"}, scenarios=[rank.VS]))
    assert plan.jobs == () and plan.unavailable


@pytest.mark.parametrize("kwargs", [
    {},                                            # no predicate field
    {"rank_max": 3, "status": "winning"},          # ranking and benchmark predicates mixed
    {"rank_max": 0},
    {"margin_min": 5, "margin_max": 1},
    {"metric_min": 4, "metric_max": 4},
])
def test_invalid_predicates_are_rejected(kwargs):
    with pytest.raises(ValueError):
        SelectionPredicate(**kwargs)


def test_the_selection_block_loads_in_the_engine_strict_loader():
    selection_module = pytest.importorskip("matbodh_views.selection", reason="engine package not importable")
    from matbodh_dashboard.compiler.rounds import resolve_rounds
    from tests.compiler.engine_stub import explicit_request

    config = only_job(rank_selection(rank._seat(), SelectionPredicate(rank_max=5)))
    rounds = resolve_rounds(rank._ctx(), rank._catalogue())
    selection = {**config["selection"],
                 "source_request": explicit_request(config["selection"]["source_request"], rounds)}
    view = selection_module.selection_view_from_dict(selection)
    assert view.rank_max == 5 and view.source_request is not None
