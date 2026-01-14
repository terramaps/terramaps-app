"""Me routes."""

from fastapi import APIRouter

from src.schemas.accounts import User
from src.services.auth import CurrentUserDependency

accounts_router = APIRouter(
    prefix="/v1.0/me",
    tags=["Me"],
)


@accounts_router.get("/", response_model=User)
def get_me(
    current_user: CurrentUserDependency,
):
    """Get the currently logged in user."""
    return User(
        id=current_user.id,
        email=current_user.email,
    )
