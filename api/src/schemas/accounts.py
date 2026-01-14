"""Accounts schemas."""

from pydantic import BaseModel, EmailStr


class User(BaseModel):
    """User schema."""

    id: int
    email: EmailStr
