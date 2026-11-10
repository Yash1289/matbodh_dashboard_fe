import pytest

from tests.cards.samples import FAMILY_SAMPLES, load_sample

CASES = [(family, name) for family, names in FAMILY_SAMPLES.items() for name in names]


@pytest.mark.parametrize(("family", "name"), CASES)
def test_every_family_sample_loads(family, name):
    result = load_sample(name)
    if family == "gender_differential":
        assert result["gender_differentials"]
    else:
        assert "rows" in result and "contract" in result


@pytest.mark.parametrize(("family", "name"), CASES)
def test_samples_are_aggregate_only(family, name):
    assert "respondents" not in load_sample(name)
