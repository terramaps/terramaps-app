"""Auth dtos module."""

from pydantic import BaseModel, EmailStr, Field


class RegisterDTO(BaseModel):
    """POST model for creating a new user."""

    name: str
    email: EmailStr
    password: str = Field(
        min_length=8,  # Minimum length of 8 characters
    )


class LoginDTO(BaseModel):
    """POST model for logging in a user."""

    email: EmailStr
    password: str
    remember_me: bool = False
