"""Graph schemas."""

from collections.abc import Sequence
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, field_validator, model_validator

from src.models.exports import MapExportModel
from src.models.graph import MapModel
from src.models.jobs import MapJobModel
from src.schemas.uploads import MapImportState

if TYPE_CHECKING:
    from src.models.uploads import MapUploadModel

class DataFieldConfig(BaseModel):
    """Data field config entry stored on a map."""

    field: str
    """Normalized JSONB key used in node/zip data dicts (lowercase alphanumeric + underscore)."""
    label: str = ""
    """Display name shown in the UI. Defaults to field if not set."""
    type: Literal["text", "number"]
    aggregations: list[Literal["sum", "avg", "min", "max"]]
    precision: int = 4
    """Max decimal places for display (1–4). Computed from source zip data at import time."""

    @staticmethod
    def create(config: dict[Any, Any]) -> "DataFieldConfig":
        return DataFieldConfig(
            field=config["field"],
            label=config.get("label", config["field"]),
            type=config["type"],
            aggregations=config.get("aggregations", []),
            precision=config.get("precision", 4),
        )


class MapJob(BaseModel):
    """Background recompute job for a map (geometry or data). Import lifecycle is tracked separately via MapImportState."""

    id: str
    job_type: Literal["recompute_geometry", "recompute_data"]
    status: Literal["pending", "processing", "complete", "failed"]
    step: str | None = None
    error: str | None = None

    @staticmethod
    def create(job: MapJobModel) -> "MapJob":
        return MapJob(
            id=job.id,
            job_type=job.job_type,
            status=job.status,
            step=job.step,
            error=job.error,
        )


class MapExport(BaseModel):
    """Active PPT export session for a map."""

    id: str
    status: Literal["pending", "in_progress", "generating", "complete", "failed"]
    total_slides: int
    uploaded_slides: int

    @staticmethod
    def create(export: MapExportModel, uploaded_slides: int) -> "MapExport":
        return MapExport(
            id=export.id,
            status=export.status,
            total_slides=export.total_slides,
            uploaded_slides=uploaded_slides,
        )


class Map(BaseModel):
    """Map."""

    id: str
    name: str
    tile_version: int = 0
    data_field_config: list[DataFieldConfig] | None = None
    active_job: MapJob | None = None
    """Active recompute job, if any. Null during import and when idle."""
    active_export: MapExport | None = None
    """Active PPT export session, if any. Null when idle or after completion."""
    import_state: MapImportState
    """Import lifecycle state. Non-nullable — all maps are created via the upload flow."""
    updated_at: datetime | None = None

    @staticmethod
    def create(
        map_model: MapModel,
        upload: "MapUploadModel",
        active_job: MapJob | None,
        active_export: MapExport | None = None,
    ) -> "Map":
        return Map(
            id=map_model.id,
            name=map_model.name,
            tile_version=map_model.tile_version,
            data_field_config=map_model.data_field_config,
            active_job=active_job,
            active_export=active_export,
            import_state=MapImportState.create(upload),
            updated_at=map_model.updated_at,
        )


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
