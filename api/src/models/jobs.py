"""Job tracking models."""

from typing import Literal

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from src.models.base import Base, TimestampMixin


class MapJobModel(Base, TimestampMixin):
    """Tracks background jobs scoped to a map (import, recompute, etc.)."""

    __tablename__ = "map_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    map_id: Mapped[str] = mapped_column(ForeignKey("maps.id"))
    job_type: Mapped[Literal["import"]]
    status: Mapped[Literal["pending", "processing", "complete", "failed"]]
    step: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    error: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)

    @declared_attr.directive
    def __table_args__(cls):
        """Table args for MapJobModel."""
        return (Index("idx_map_jobs_map_id", "map_id"),)
