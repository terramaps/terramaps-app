"""Geography models."""

from geoalchemy2 import Geometry
from geoalchemy2.elements import WKBElement
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base, TimestampMixin


class ZipCodeGeography(Base, TimestampMixin):
    """Zip code geography model."""

    __tablename__ = "geography_zip_codes"

    zip_code: Mapped[str] = mapped_column(String(5), primary_key=True)
    color: Mapped[str] = mapped_column(String(7), nullable=False)
    """Hex color string (e.g. '#E05252'). No two adjacent zip codes share the same value."""
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
    geom_z3_merc: Mapped[WKBElement | None] = mapped_column(
        Geometry(srid=3857, spatial_index=False),
        nullable=True,
        deferred=True,
    )
    geom_z7: Mapped[WKBElement | None] = mapped_column(
        Geometry(srid=4326),
        nullable=True,
        deferred=True,
    )
    geom_z7_merc: Mapped[WKBElement | None] = mapped_column(
        Geometry(srid=3857, spatial_index=False),
        nullable=True,
        deferred=True,
    )
    geom_z11: Mapped[WKBElement | None] = mapped_column(
        Geometry(srid=4326),
        nullable=True,
        deferred=True,
    )
    geom_z11_merc: Mapped[WKBElement | None] = mapped_column(
        Geometry(srid=3857, spatial_index=False),
        nullable=True,
        deferred=True,
    )
