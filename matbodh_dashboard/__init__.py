"""MatBodh survey-analytics dashboard backend."""
from importlib.metadata import version


def engine_version() -> str:
    """Return the installed MatBodh engine (matbodh-survey-backend) version."""
    return version("matbodh-survey-backend")
