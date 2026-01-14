"""Authentication service module."""

import logging
from datetime import UTC, datetime, timedelta
from sqlite3 import IntegrityError
from typing import Annotated, Literal, NotRequired, TypedDict

import jwt
from fastapi import Depends, HTTPException, Request, status
from passlib.context import CryptContext
from sqlalchemy import select

from src.app.config import app_settings
from src.app.database import DatabaseSession
from src.models.accounts import UserModel

from .base import BaseService

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

logger = logging.getLogger(__name__)


class AuthenticationError(Exception):
    """Base exception for authentication failures."""

    def __init__(self, message: str = "Authentication failed"):
        """Initialize the AuthenticationError."""
        super().__init__(message)


class JWTPayloadData(TypedDict):
    """Type definition for JWT payload data."""

    sub: str
    type: Literal["access", "refresh"]
    exp: NotRequired[datetime]


class AuthService(BaseService):
    """Authentication service."""

    def register_user(self, email: str, password: str) -> UserModel:
        """Register a new user."""
        try:
            new_user = UserModel(email=email, password=self._get_password_hash(password))
            self.db.add(new_user)
            self.db.flush()
        except IntegrityError as err:
            logger.exception(f"Failed to register user with email {email}.")
            raise AuthenticationError(f"User with email {email} already exists.") from err
        return new_user

    def authenticate_user(self, email: str, password: str) -> UserModel:
        """Authenticate a user."""
        user = self.db.scalars(select(UserModel).filter(UserModel.email == email)).one_or_none()

        if not user or not self._verify_password(password, user.password):
            raise AuthenticationError(email)

        return user

    def create_access_token(self, data: JWTPayloadData, expires_delta: timedelta | None = None) -> str:
        """Create a JWT access token."""
        to_encode: JWTPayloadData = data.copy()
        expire = datetime.now(UTC) + (expires_delta or timedelta(minutes=app_settings.jwt.access_token_expire_minutes))
        to_encode["exp"] = expire
        to_encode["type"] = "access"

        return jwt.encode(dict(to_encode), app_settings.jwt.secret, algorithm=app_settings.jwt.algorithm)

    def create_refresh_token(self, data: JWTPayloadData, expires_delta: timedelta | None = None) -> str:
        """Create a JWT refresh token."""
        to_encode: JWTPayloadData = data.copy()
        expire = datetime.now(UTC) + (expires_delta or timedelta(days=app_settings.jwt.refresh_token_expire_days))
        to_encode["exp"] = expire
        to_encode["type"] = "refresh"

        return jwt.encode(dict(to_encode), app_settings.jwt.secret, algorithm=app_settings.jwt.algorithm)

    def get_current_user(self, token: str | None) -> UserModel:
        """Get the current user from the token."""
        if not token:
            raise AuthenticationError()
        try:
            payload = jwt.decode(token, app_settings.jwt.secret, algorithms=[app_settings.jwt.algorithm])
            user_id: int | None = payload.get("sub")
            if not user_id:
                raise AuthenticationError()
        except jwt.PyJWTError as err:
            raise AuthenticationError() from err
        user = self.db.get(UserModel, user_id)
        if user is None:
            raise AuthenticationError()
        return user

    def _get_password_hash(self, password: str) -> str:
        """Hash a password."""
        return pwd_context.hash(password)

    def _verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Verify a password."""
        return pwd_context.verify(plain_password, hashed_password)

    def get_user_token(self, email: str) -> UserModel | None:
        """Get a user by their email."""
        return self.db.scalars(select(UserModel).filter(UserModel.email == email)).one_or_none()


def get_auth_service(db: DatabaseSession) -> AuthService:
    """Get accounts service."""
    return AuthService(db=db)


AuthServiceDependency = Annotated[AuthService, Depends(get_auth_service)]


def _get_current_user_dependency(
    auth_service: AuthServiceDependency,
    request: Request,
) -> UserModel:
    """Dependency to get the current user from the request."""
    try:
        logger.debug("Retrieving current user: %s", request.cookies.get("access_token"))
        return auth_service.get_current_user(request.cookies.get("access_token"))
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        ) from err


CurrentUserDependency = Annotated[UserModel, Depends(_get_current_user_dependency)]
