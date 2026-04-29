"""PPT export models."""

from typing import Any, Literal

from sqlalchemy import ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from src.models.base import Base, TimestampMixin, intpk, uuidpk


class MapExportModel(Base, TimestampMixin):
    """Tracks a PPT export session scoped to a map.

    All slides are pre-computed at creation. The frontend works through them
    one at a time via GET /next → POST /slides/{id} until all are uploaded,
    then calls POST /generate to assemble the file.
    """

    __tablename__ = "map_exports"

    id: Mapped[uuidpk] = mapped_column(init=False)
    map_id: Mapped[str] = mapped_column(ForeignKey("maps.id"))
    status: Mapped[Literal["pending", "in_progress", "generating", "complete", "failed"]]
    total_slides: Mapped[int]

    @declared_attr.directive
    def __table_args__(cls):
        return (Index("idx_map_exports_map_id", "map_id"),)


class MapExportSlideModel(Base, TimestampMixin):
    """One slide in a PPT export.

    Fully pre-computed at export creation time (bbox, title, node_data).
    image_s3_key is null until the frontend uploads the screenshot.
    """

    __tablename__ = "map_export_slides"

    id: Mapped[intpk] = mapped_column(init=False)
    export_id: Mapped[str] = mapped_column(ForeignKey("map_exports.id"))
    order: Mapped[int]
    title: Mapped[str]
    layer_id: Mapped[int] = mapped_column(ForeignKey("layers.id"))
    parent_node_id: Mapped[int | None] = mapped_column(ForeignKey("nodes.id"), nullable=True, default=None)

    bbox_min_lng: Mapped[float | None] = mapped_column(nullable=True, default=None)
    bbox_min_lat: Mapped[float | None] = mapped_column(nullable=True, default=None)
    bbox_max_lng: Mapped[float | None] = mapped_column(nullable=True, default=None)
    bbox_max_lat: Mapped[float | None] = mapped_column(nullable=True, default=None)

    node_data: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True, default=None)
    """Snapshot of child nodes at export creation: [{name, ...data_fields}]. Shape varies per map."""

    image_s3_key: Mapped[str | None] = mapped_column(nullable=True, default=None)
    """UUID key in the private S3 bucket. Null until screenshot is uploaded."""

    @declared_attr.directive
    def __table_args__(cls):
        return (
            UniqueConstraint("export_id", "order"),
            Index("idx_map_export_slides_export_id", "export_id"),
        )
