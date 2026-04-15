"""Layers models."""

from typing import Any

from geoalchemy2 import Geometry
from geoalchemy2.elements import WKBElement
from sqlalchemy import ForeignKey, UniqueConstraint, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, aliased, column_property, declared_attr, mapped_column

from src.models.base import Base, intpk


class MapModel(Base):
    """Map model."""

    __tablename__ = "maps"

    id: Mapped[intpk] = mapped_column(init=False)
    name: Mapped[str]
    data_field_config: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSONB,
        nullable=True,
        default=None,
    )
    """Per-field aggregation config. Each entry: {"field": str, "aggregations": ["sum"|"avg"]}"""


class LayerModel(Base):
    """Defines a layer in the hierarchy (e.g., Territory, Region, Zip)."""

    __tablename__ = "layers"

    id: Mapped[intpk] = mapped_column(init=False)
    map_id: Mapped[int] = mapped_column(ForeignKey("maps.id"))
    name: Mapped[str]
    order: Mapped[int]
    """Order of the layer (aka 0 will always be zip, 1 will usually be territory, etc.)"""

    @declared_attr.directive
    def __table_args__(cls):
        """Table args for LayerModel."""
        return (
            UniqueConstraint("order", "map_id"),
            UniqueConstraint("name", "map_id"),
        )


class NodeModel(Base):
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
    data_cache_key: Mapped[str]
    data_inputs_cache_key: Mapped[str]
    geom: Mapped[WKBElement | None] = mapped_column(
        Geometry(srid=4326),
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
    geom_z15: Mapped[WKBElement | None] = mapped_column(
        Geometry(srid=4326),
        nullable=True,
        deferred=True,
    )
    geom_cache_key: Mapped[str]
    geom_inputs_cache_key: Mapped[str]

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
        return (UniqueConstraint("layer_id", "name"),)
