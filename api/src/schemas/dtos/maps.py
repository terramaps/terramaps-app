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
    aggregations: list[Literal["sum", "avg", "min", "max"]] = []
    """Aggregation rules applied to direct children. Only meaningful when type == "number"."""


class CreateMap(BaseModel):
    """DTO for POST /maps.

    References a previously uploaded and parsed document. The raw spreadsheet
    data stays in S3 and is read by the background import worker.
    """

    document_id: str
    """ID of a MapUploadModel record with status == 'ready'."""
    name: str
    layers: Sequence[LayerSetup]
    data_fields: Sequence[DataFieldSetup]
