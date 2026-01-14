"""Account models."""

from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, intpk


class UserModel(Base, TimestampMixin):
    """User model."""

    id: Mapped[intpk] = mapped_column(init=False)
    email: Mapped[str] = mapped_column(CITEXT, unique=True, nullable=False)

    # TODO replace with permissions and real password
    password: Mapped[str]


class TeamModel(Base, TimestampMixin):
    """Team model."""

    id: Mapped[intpk] = mapped_column(init=False)
    name: Mapped[str]
