"""Graph schemas."""

from collections.abc import Sequence
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, field_validator, model_validator


class DataFieldConfig(BaseModel):
    """Data field config entry stored on a map."""

    field: str
    type: Literal["text", "number"]
    aggregations: list[Literal["sum", "avg"]]


class MapJob(BaseModel):
    """Background job for a map."""

    id: str
    job_type: Literal["import", "recompute_geometry", "recompute_data"]
    status: Literal["pending", "processing", "complete", "failed"]
    step: str | None = None
    error: str | None = None


class Map(BaseModel):
    """Map."""

    id: str
    name: str
    tile_version: int = 0
    data_field_config: list[DataFieldConfig] | None = None
    active_job: MapJob | None = None
    updated_at: datetime | None = None


class Layer(BaseModel):
    """Layer."""

    id: int
    map_id: str
    name: str
    order: int


class NodeAncestor(BaseModel):
    """One ancestor level in a node's hierarchy chain."""

    layer_id: int
    layer_name: str
    node_id: int
    node_name: str
    node_color: str


class Node(BaseModel):
    """Node."""

    id: int
    layer_id: int
    name: str
    color: str
    parent_node_id: int | None = None
    child_count: int = 0
    data: dict[str, Any] | None = None
    ancestors: list[NodeAncestor] | None = None


class PaginatedNodes(BaseModel):
    """Paginated nodes response."""

    nodes: Sequence[Node]
    total: int
    page: int
    page_size: int
    total_pages: int


class ZipAssignment(BaseModel):
    """A zip code's assignment state on a map layer.

    Represents a zip_assignments row. Implicit zips (no row) are only visible
    via MVT tiles and are not returned by the API as individual objects.
    """

    zip_code: str
    layer_id: int
    parent_node_id: int | None = None
    color: str
    data: dict[str, Any] | None = None

    @field_validator("zip_code")
    @classmethod
    def pad_zip_code(cls, v: str) -> str:
        """Ensure zip codes are always zero-padded to 5 characters."""
        return v.zfill(5)


class PaginatedZipAssignments(BaseModel):
    """Paginated zip assignments response."""

    zip_assignments: Sequence[ZipAssignment]
    total: int
    page: int
    page_size: int
    total_pages: int


class SearchResultItem(BaseModel):
    """A single search result — either a territory node or a zip code."""

    type: Literal["node", "zip"]
    id: int | str
    """Node id (int) or zip_code string."""
    name: str
    layer_id: int
    layer_name: str
    color: str
    centroid: list[float] | None = None
    """[lng, lat] derived from PostGIS geometry centroid. Null if geometry not yet computed."""

    @model_validator(mode="after")
    def _validate_id_type(self) -> "SearchResultItem":
        if self.type == "node" and not isinstance(self.id, int):
            raise ValueError("node results must have an integer id")
        if self.type == "zip" and not isinstance(self.id, str):
            raise ValueError("zip results must have a string id")
        return self


class SearchResults(BaseModel):
    """Search results grouped from nodes and zip codes across a map."""

    results: list[SearchResultItem]
    total: int
