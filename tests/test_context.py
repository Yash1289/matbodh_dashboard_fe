import pytest
from pydantic import ValidationError

from matbodh_dashboard.catalogue.store import load_catalogue
from matbodh_dashboard.context import Context, StateContext
from matbodh_dashboard.capability import validate_context, resolve_anchor
from tests.fixtures.catalogue_rows import make_query

R1 = "2027 VS CAPI R1"
R2 = "2027 VS CAPI R2"
ST = "2027 VS CAPI ST R1"


@pytest.fixture()
def catalogue():
    return load_catalogue(make_query())


def ctx(**kw):
    base = {"state": "Uttar Pradesh", "level": "ac", "rounds": [R1]}
    base.update(kw)
    return StateContext(**base)


def test_valid_context(catalogue):
    assert validate_context(ctx(rounds=[R1, R2], compare_round=R1), catalogue) == []


def test_rounds_must_share_level(catalogue):
    errors = validate_context(ctx(rounds=[R1, ST]), catalogue)
    assert errors
    assert any(R1 in e and ST in e for e in errors)


def test_level_must_match_rounds(catalogue):
    assert validate_context(ctx(level="pc"), catalogue)


def test_compare_round_must_be_selected(catalogue):
    errors = validate_context(ctx(rounds=[R1], compare_round=R2), catalogue)
    assert any("compare_round" in e for e in errors)


def test_matched_rejected_for_state_level(catalogue):
    c = ctx(level="zone", rounds=[ST], version_mode="matched")
    assert any("matched" in e for e in validate_context(c, catalogue))
    assert validate_context(ctx(level="zone", rounds=[ST]), catalogue) == []


def test_anchor_defaults_to_latest(catalogue):
    assert resolve_anchor(ctx(rounds=[R1, R2]), catalogue) == R2


def test_explicit_anchor_used_and_validated(catalogue):
    c = ctx(rounds=[R1, R2], anchor_round=R1)
    assert resolve_anchor(c, catalogue) == R1
    assert validate_context(c, catalogue) == []
    bad = ctx(rounds=[R1], anchor_round=R2)
    assert any("anchor_round" in e for e in validate_context(bad, catalogue))


def test_unknown_round_rejected(catalogue):
    errors = validate_context(ctx(rounds=["nope"]), catalogue)
    assert any("nope" in e for e in errors)


def test_unknown_state_rejected(catalogue):
    assert validate_context(ctx(state="Atlantis"), catalogue)


def test_empty_rounds_rejected(catalogue):
    assert validate_context(ctx(rounds=[]), catalogue)


def test_extra_fields_forbidden():
    with pytest.raises(ValidationError):
        StateContext(state="X", level="ac", rounds=[], bogus=1)
    with pytest.raises(ValidationError):
        StateContext(state="X", level="district", rounds=[])


def test_context_wrapper():
    c = Context(states=[ctx()], focus_party="BJP")
    assert c.focus_party == "BJP"
