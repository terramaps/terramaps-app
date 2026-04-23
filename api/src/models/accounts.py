"""Account models."""

from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, intpk


class UserModel(Base, TimestampMixin):
    """User model."""

    __tablename__ = "users"

    id: Mapped[intpk] = mapped_column(init=False)
    email: Mapped[str] = mapped_column(CITEXT, unique=True, nullable=False)

    password: Mapped[str]

    name: Mapped[str | None] = mapped_column(default=None)
