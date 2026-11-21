"""One configure descriptor per card family (spec 6a, sections 5.1-5.8 and 6.3).

Field order is display order. First open shows only the primary fields: what the card measures, how
it is split, and its mode. Everything else waits behind "More options".
"""
from __future__ import annotations

from functools import lru_cache

from matbodh_dashboard.cards.config import OPINION_MEASURES, PARTY_MEASURES, TOP_K_MAX
from matbodh_dashboard.cards.configure.descriptor import (
    All, Contains, Equals, FamilyDescriptor, FieldDescriptor, In, KindOf, Not, OptionSource,
)
from matbodh_dashboard.cards.families import family_meta, get_family

COMPARE = Equals(path="comparison.mode", value="compare")
TREND = Equals(path="comparison.mode", value="trend")
NOT_COMPARE = Not(of=COMPARE)
RECALLED_STATUSES = ["Did Not Vote", "Do Not Remember"]


def _f(path: str, label: str, widget: str, **kw) -> FieldDescriptor:
    return FieldDescriptor(path=path, label=label, widget=widget, **kw)


def _options(source: str, **params) -> OptionSource:
    return OptionSource(source=source, params=params)


def _title() -> FieldDescriptor:
    return _f("title", "Title", "text", required=True, tier="primary", limits={"max_length": 200})


def _scenarios(kind: str, *, multiple: bool, show_when=NOT_COMPARE, label="Question") -> FieldDescriptor:
    return _f("scenarios", label + ("s" if multiple else ""), "scenario_picker", required=True, tier="primary",
              multiple=multiple, show_when=show_when, options=_options("scenarios", kind=kind),
              limits={"max_items": 12} if multiple else {})


# An unset mode is standalone: conditions are evaluated before the mode default is written, so say it by what it is not.
# (In, not Equals: the compare block of Configure is the fields that read the compare mode as two questions.)
NOT_STANDALONE = In(path="comparison.mode", values=["compare", "trend"])
IS_STANDALONE = All(of=[Not(of=COMPARE), Not(of=TREND)])


def _surveys_field() -> FieldDescriptor:
    return _f("surveys", "Surveys", "choice", multiple=True, tier="primary",
              show_when=IS_STANDALONE, options=_options("surveys"),
              help="Empty uses the context's anchor round. One survey reads it; several are read side by side. "
                   "With several surveys or questions, a split shows one at a time")


def _mode(choices=("standalone", "compare", "trend")) -> FieldDescriptor:
    return _f("comparison.mode", "Show", "choice", tier="primary", choices=list(choices), default="standalone",
              help="standalone: the anchor round; compare: anchor vs the comparison round (or two questions "
                   "in one round); trend: the pipe rounds")


def _compare(target_kind: str, reference_kind: str) -> list[FieldDescriptor]:
    """Compare endpoints: a round (anchor or compare, from the context) and a question each."""
    return [
        _f("comparison.target.scenario", "Question", "scenario_picker", required=True, tier="primary",
           show_when=COMPARE, options=_options("scenarios", kind=target_kind)),
        _f("comparison.reference.scenario", "Compared with", "scenario_picker", required=True, tier="primary",
           show_when=COMPARE, options=_options("scenarios", kind=reference_kind),
           help="A party question compared with an opinion question is a Shakti comparison"),
        _f("comparison.target.round", "Question's round", "choice", show_when=COMPARE,
           choices=["anchor", "compare"], default="anchor"),
        _f("comparison.reference.round", "Compared with, round", "choice", show_when=COMPARE,
           choices=["anchor", "compare"], default="compare",
           help="Same round as the question: compare two questions within one round"),
    ]


def _cuts(**params) -> FieldDescriptor:
    return _f("cuts", "Split by", "cut_builder", tier="primary", default=[[]], limits={"max_items": 8},
              options=_options("fields", use="cut", **params),
              help="Each cut is its own table; fields in one cut are crossed. Empty = overall")


def _filters() -> FieldDescriptor:
    return _f("filters", "Only respondents where", "filter_list", limits={"max_items": 8, "max_values": 200},
              options=_options("fields", use="filter"))


def _caste_clubbing() -> FieldDescriptor:
    return _f("caste_clubbing", "Club small castes", "toggle", default=False,
              show_when=Contains(path="cuts", value="caste"))


def _pipe_rounds(show_when=TREND) -> FieldDescriptor:
    return _f("pipe_rounds", "Rounds to show", "number", show_when=show_when, limits={"min": 1},
              help="The last N pipe rounds up to the anchor; empty = all of them")


def _survey(label="Survey", *, show_when=None, seat=False) -> FieldDescriptor:
    """This card's own survey instead of the context's anchor (empty = the context's)."""
    return _f("anchor_round", label, "choice", show_when=show_when, options=_options("surveys", seat=seat),
              tier="primary", help="Empty uses the context's anchor round")


def _compare_survey(seat=False, show_when=In(path="comparison.mode", values=["compare"])) -> FieldDescriptor:
    return _f("compare_round", "Compared with survey", "choice", show_when=show_when, options=_options("surveys", seat=seat),
              help="Empty uses the context's comparison round")


def _display_parties() -> FieldDescriptor:
    return _f("display_parties", "Show only these parties", "party_picker", multiple=True,
              options=_options("parties", use="hide"), help="Hides rows after calculation; bases are unchanged")


def _ranking(level: FieldDescriptor, *, seat: bool) -> list[FieldDescriptor]:
    fields = [
        _title(),
        level,
        _scenarios("any", multiple=False),
        _f("rank.metric", "Rank by", "metric_picker", required=True, tier="primary", options=_options("metrics")),
        _f("rank.party_id", "Party", "party_picker", required=True, tier="primary",
           show_when=Equals(path="rank.metric", value="support_share"), options=_options("parties", use="rank")),
        _survey(seat=True), _compare_survey(seat=True),
        _mode(),
        *_compare("any", "any"),
    ]
    if seat:
        fields += [
            _f("rank.top_k", "Top N in each group", "number", limits={"min": 1}),
            _f("rank.partition_by", "Rank within", "choice", multiple=True,
               options=_options("fields", use="seat_attribute")),
            _f("rank.filters", "Only seats where", "filter_list", limits={"max_items": 8, "max_values": 200},
               options=_options("fields", use="seat_attribute")),
        ]
    else:
        fields += [
            _f("rank.top_k", "Top N in each group", "number", required=True, tier="primary", default=3,
               limits={"min": 1, "max": TOP_K_MAX}),
            _f("rank.partition_by", "Rank within", "choice", multiple=True,
               options=_options("fields", use="partition")),
            _filters(),
        ]
    return [*fields, _pipe_rounds()]


def _family(name: str, label: str, description: str, fields: list[FieldDescriptor]) -> FamilyDescriptor:
    return FamilyDescriptor(family=name, label=label, description=description, fields=fields,
                            meta=family_meta(get_family(name)))


@lru_cache(maxsize=1)
def _all() -> tuple[FamilyDescriptor, ...]:
    party_delta = _f("comparison.delta_measures", "Change in", "choice", multiple=True,
                     choices=list(PARTY_MEASURES), default=list(PARTY_MEASURES[:1]),
                     show_when=All(of=[COMPARE, KindOf(path="comparison.reference.scenario", kind="party")]))
    opinion_delta = _f("comparison.delta_measures", "Change in", "choice", multiple=True,
                       choices=list(OPINION_MEASURES), default=list(OPINION_MEASURES[:1]),
                       show_when=All(of=[COMPARE, KindOf(path="comparison.target.scenario", kind="opinion"),
                                         KindOf(path="comparison.reference.scenario", kind="opinion")]))
    every_party = Equals(path="all_party_scenarios", value=True)
    return (
        _family("distribution", "Party vote share",
                "Vote share for one or more party questions, split by the cuts you choose.", [
                    _title(),
                    _scenarios("party", multiple=True, show_when=All(of=[NOT_COMPARE, Not(of=every_party)])),
                    _surveys_field(), _survey(show_when=NOT_STANDALONE), _compare_survey(),
                    _mode(),
                    *_compare("party", "any"),
                    _cuts(),
                    _f("all_party_scenarios", "Every party question of the anchor round", "toggle", default=False,
                       show_when=Equals(path="comparison.mode", value="standalone")),
                    party_delta,
                    _filters(), _caste_clubbing(), _pipe_rounds(), _display_parties(),
                ]),
        _family("opinion", "Opinion",
                "Ratings and yes/no questions: positive, negative and net shares.", [
                    _title(), _scenarios("opinion", multiple=True), _surveys_field(),
                    _survey(show_when=NOT_STANDALONE), _compare_survey(),
                    _mode(), *_compare("opinion", "opinion"),
                    _cuts(), opinion_delta, _filters(), _caste_clubbing(), _pipe_rounds(),
                ]),
        _family("gender_differential", "Gender gap", "How women and men differ in party support.", [
                    _title(), _scenarios("party", multiple=True, show_when=None), _survey(),
                    _mode(("standalone", "trend")), _cuts(family="gender_differential"),
                    _filters(), _caste_clubbing(), _pipe_rounds(), _display_parties(),
                ]),
        _family("seat_ranking", "Seat ranking",
                "Rank ACs or PCs by a party's support or an opinion score.",
                _ranking(_f("rank.level", "Seats", "choice", required=True, tier="primary",
                            choices=["ac", "pc"]), seat=True)),
        _family("demographic_ranking", "Group ranking",
                "Rank groups such as castes or ages within each area by a party's support or an opinion score.",
                _ranking(_f("rank.level", "Groups", "choice", required=True, tier="primary",
                            options=_options("fields", use="level")), seat=False)),
        _family("seat_benchmark", "Seat benchmark",
                "Seats won and vote share, against the comparison round or a past election.", [
                    _title(), _scenarios("party", multiple=False, show_when=None),
                    _survey(seat=True), _compare_survey(seat=True, show_when=None),
                    _f("benchmark.reference", "Compared with", "election_picker", tier="primary",
                       options=_options("elections"),
                       help="Nothing, the comparison round (when left empty), or a past election"),
                    _f("benchmark.grouping_sets", "Group seats by", "cut_builder", tier="primary", default=[[]],
                       limits={"max_items": 8}, options=_options("fields", use="seat_attribute")),
                    _f("benchmark.focal_party", "Focal party", "party_picker",
                       options=_options("parties", use="focal"), help="Gives margins and seat flips"),
                    _f("benchmark.contenders", "Parties shown", "party_picker", multiple=True,
                       options=_options("parties", use="contenders"),
                       help="Parties left out still compete and win seats; they count in Other"),
                ]),
        _family("relationship", "Vote movement",
                "How answers to one party question carry over to another, such as past vote to current vote.", [
                    _title(),
                    _f("relationship.origin", "From", "scenario_picker", required=True, tier="primary",
                       options=_options("scenarios", kind="party")),
                    _f("relationship.destination", "To", "scenario_picker", required=True, tier="primary",
                       options=_options("scenarios", kind="party")),
                    _cuts(),
                    _f("relationship.focal_party", "Focal party", "party_picker",
                       options=_options("parties", use="focal"), help="Gives retention, loss and gains"),
                    _f("relationship.include_recalled.origin", "Also count (from)", "choice", multiple=True,
                       choices=RECALLED_STATUSES, show_when=KindOf(path="relationship.origin", kind="recalled")),
                    _f("relationship.include_recalled.destination", "Also count (to)", "choice", multiple=True,
                       choices=RECALLED_STATUSES,
                       show_when=KindOf(path="relationship.destination", kind="recalled")),
                    _f("relationship.joint_weight.source", "Pair answers with", "choice",
                       choices=["base", "scenario"], default="base"),
                    _f("relationship.joint_weight.scenario", "Weight from question", "scenario_picker",
                       show_when=Equals(path="relationship.joint_weight.source", value="scenario"),
                       options=_options("joint_weight_scenarios")),
                    _pipe_rounds(show_when=None),
                ]),
    )


def descriptors() -> list[FamilyDescriptor]:
    return list(_all())
