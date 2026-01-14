"""Permissions models."""

from typing import Literal

from sqlalchemy import ForeignKey, Index, Integer, UniqueConstraint, text
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from .base import Base, TimestampMixin, intpk

MapRole = Literal["OWNER", "MEMBER"]


class UserMapRoleModel(Base, TimestampMixin):
    """UserMapRoleModel."""

    __tablename__ = "user_map_roles"

    id: Mapped[intpk] = mapped_column(Integer, primary_key=True, autoincrement=True, init=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    map_id: Mapped[int] = mapped_column(Integer, ForeignKey("maps.id"), nullable=False)
    role: Mapped[MapRole]

    @declared_attr.directive
    def __table_args__(cls):
        """Table args for UserMapRoleModel."""
        owner: MapRole = "OWNER"
        return (
            UniqueConstraint("user_id", "role", "map_id"),
            Index("uq_map_owner", "map_id", unique=True, postgresql_where=text(f"role = '{owner}'")),
        )
