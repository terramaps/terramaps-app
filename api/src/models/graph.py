"""Layers models."""

from typing import Any

from geoalchemy2 import Geometry
from geoalchemy2.elements import WKBElement
from sqlalchemy import ForeignKey, Index, String, UniqueConstraint, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, aliased, column_property, declared_attr, mapped_column

from src.models.base import Base, TimestampMixin, intpk, uuidpk


class MapModel(Base, TimestampMixin):
    """Map model."""

    __tablename__ = "maps"

    id: Mapped[uuidpk] = mapped_column(init=False)
    name: Mapped[str]
    tile_version: Mapped[int] = mapped_column(default=0, server_default="0")
    """Incremented after each successful geometry recompute. Used by the frontend to cache-bust MVT tile URLs."""
    data_field_config: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSONB,
        nullable=True,
        default=None,
    )
    """Per-field aggregation config. Each entry: {"field": str, "aggregations": ["sum"|"avg"]}"""


class LayerModel(Base, TimestampMixin):
    """Defines a layer in the hierarchy (e.g., Territory, Region, Zip)."""

    __tablename__ = "layers"

    id: Mapped[intpk] = mapped_column(init=False)
    map_id: Mapped[str] = mapped_column(ForeignKey("maps.id"))
    name: Mapped[str]
    order: Mapped[int]
    """Order of the layer (aka 0 will always be zip, 1 will usually be territory, etc.)"""

    @declared_attr.directive
    def __table_args__(cls):
        """Table args for LayerModel."""
        return (
            UniqueConstraint("order", "map_id"),
            UniqueConstraint("name", "map_id"),
            Index("idx_layers_map_id", "map_id"),
        )


class NodeModel(Base, TimestampMixin):
    """Node."""

    __tablename__ = "nodes"

    id: Mapped[intpk] = mapped_column(init=False)
    layer_id: Mapped[int] = mapped_column(ForeignKey("layers.id"))
    name: Mapped[str]
    color: Mapped[str]

    data: Mapped[dict[Any, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
        deferred=True,
    )
    geom_z3: Mapped[WKBElement | None] = mapped_column(
        Geometry(srid=4326),
        nullable=True,
        deferred=True,
    )
    geom_z7: Mapped[WKBElement | None] = mapped_column(
        Geometry(srid=4326),
        nullable=True,
        deferred=True,
    )
    geom_z11: Mapped[WKBElement | None] = mapped_column(
        Geometry(srid=4326),
        nullable=True,
        deferred=True,
    )
    parent_node_id: Mapped[int | None] = mapped_column(ForeignKey("nodes.id"), nullable=True)

    @classmethod
    def __declare_last__(cls):
        """Attach correlated child_count after mapper configuration.

        Using __declare_last__ avoids premature inspection errors that occur
        when attempting to alias the class inside @declared_attr before mapping.
        """
        child_alias = aliased(cls)
        cls.child_count = column_property(
            select(func.count(child_alias.id))
            .where(child_alias.parent_node_id == cls.id)
            .correlate_except(child_alias)
            .scalar_subquery()
        )

    @declared_attr.directive
    def __table_args__(cls):
        """Table args for NodeModel."""
        return (
            UniqueConstraint("layer_id", "name"),
            Index("idx_nodes_layer_id", "layer_id"),
            Index("idx_nodes_parent_node_id", "parent_node_id"),
        )


class ZipAssignmentModel(Base, TimestampMixin):
    """Assignment of a zip code to a layer, optionally under a parent territory node.

    A row only exists when there is something meaningful to record — a parent territory,
    custom data, or a preserved color from a previous assignment. Zip codes with no row
    are implicitly present on the map and displayed in white.

    Layer must be order=0. parent_node_id must point to a node in a layer with order=1.
    """

    __tablename__ = "zip_assignments"

    id: Mapped[intpk] = mapped_column(init=False)
    layer_id: Mapped[int] = mapped_column(ForeignKey("layers.id"))
    zip_code: Mapped[str] = mapped_column(String(5), ForeignKey("geography_zip_codes.zip_code"))
    parent_node_id: Mapped[int | None] = mapped_column(ForeignKey("nodes.id"), nullable=True)
    color: Mapped[str]
    """Display color for this zip. Copied from geography_zip_codes.color on first assignment.
    Preserved when parent_node_id is cleared (unassign). Deleted row resets to white."""

    data: Mapped[dict[Any, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
        deferred=True,
    )

    @declared_attr.directive
    def __table_args__(cls):
        """Table args for ZipAssignmentModel."""
        return (
            UniqueConstraint("layer_id", "zip_code"),
            Index("idx_zip_assignments_parent_node_id", "parent_node_id"),
        )
