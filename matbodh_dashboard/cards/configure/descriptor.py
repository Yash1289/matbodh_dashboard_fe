"""What the Configure surface draws for a family: fields, when each shows, where options come from.

Data only, built next to CardConfig (spec 6.2). The frontend renders any descriptor with one generic
renderer; CardConfig and the engine plan still decide validity (POST /cards/validate).
"""
from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

from matbodh_dashboard.cards.payload import FamilyMeta

# CardConfig paths Configure never shows as fields: chosen when the card is added (family), generated
# (id), replaced by the canvas (section), derived by the compilers (requires) or display-only (view).
DISPLAY_OR_GENERATED = frozenset({"family", "id", "section", "requires", "view"})


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# -- show-when conditions (spec 6.3): small on purpose, evaluated by the renderer on the draft --------

class Equals(_Strict):
    op: Literal["equals"] = "equals"
    path: str
    value: str | int | bool | None


class In(_Strict):
    op: Literal["in"] = "in"
    path: str
    values: list[str | int | bool]


class Nonempty(_Strict):
    op: Literal["nonempty"] = "nonempty"
    path: str


class Contains(_Strict):
    """The list (or list of lists, such as cuts) at `path` contains `value`."""

    op: Literal["contains"] = "contains"
    path: str
    value: str


class KindOf(_Strict):
    """The scenario at `path` is of this kind. A recalled scenario is also a party scenario."""

    op: Literal["kind_of"] = "kind_of"
    path: str
    kind: Literal["party", "opinion", "recalled"]


class CountAtLeast(_Strict):
    op: Literal["count_at_least"] = "count_at_least"
    path: str
    n: int


class All(_Strict):
    op: Literal["all"] = "all"
    of: list[Condition]


class Any_(_Strict):
    op: Literal["any"] = "any"
    of: list[Condition]


class Not(_Strict):
    op: Literal["not"] = "not"
    of: Condition


_Condition = Annotated[Union[Equals, In, Nonempty, Contains, KindOf, CountAtLeast, All, Any_, Not],
                       Field(discriminator="op")]


class Condition(BaseModel):
    """Parse any condition from JSON: `Condition.model_validate({"op": ..., ...})`."""

    @classmethod
    def model_validate(cls, obj, **kwargs):  # type: ignore[override]
        from pydantic import TypeAdapter

        return TypeAdapter(_Condition).validate_python(obj, **kwargs)


for _model in (All, Any_, Not):
    _model.model_rebuild(_types_namespace={"Condition": _Condition})


# -- fields and families ------------------------------------------------------------------------------

Widget = Literal["scenario_picker", "metric_picker", "cut_builder", "filter_list", "party_picker",
                 "election_picker", "number", "toggle", "choice", "text", "slot"]


class OptionSource(_Strict):
    """An option list served by POST /configure/options (the draft and context travel with it)."""

    source: str
    params: dict[str, str | int | bool] = {}


class FieldDescriptor(_Strict):
    path: str
    label: str
    help: str | None = None
    widget: Widget
    required: bool = False
    tier: Literal["primary", "more"] = "more"
    show_when: _Condition | None = None
    options: OptionSource | None = None
    choices: list[str] | None = None
    default: str | int | bool | list | None = None
    limits: dict[str, int] = {}
    multiple: bool = False


class FamilyDescriptor(_Strict):
    family: str
    label: str
    description: str
    fields: list[FieldDescriptor]
    meta: FamilyMeta
