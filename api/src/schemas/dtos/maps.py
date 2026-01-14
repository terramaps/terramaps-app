"""Map DTOs."""

from collections.abc import Sequence
from typing import Literal

from pydantic import BaseModel


class LayerSetup(BaseModel):
    """LayerSetup."""

    name: str
    header: str


class DataFieldSetup(BaseModel):
    """DataFieldSetup."""

    name: str
    header: str
    type: Literal["text", "number"]


class ImportMap(BaseModel):
    """ImportMap."""

    name: str
    layers: Sequence[LayerSetup]
    data_fields: Sequence[DataFieldSetup]
    values: Sequence[Sequence[str | int | float | None]]
    headers: Sequence[str]

    # TODO add validation for data fields and layers to have valid headers


class ImportMapResponse(BaseModel):
    """ImportMapResponse."""

    map_id: int
    # TODO add warnings/errors
