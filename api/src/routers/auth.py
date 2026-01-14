"""Auth router module."""

import logging

import jwt
from fastapi import APIRouter, HTTPException, Request, Response, status

from src.app.config import app_settings
from src.app.database import DatabaseSession
from src.schemas.accounts import User
from src.schemas.dtos.auth import LoginDTO, RegisterDTO
from src.services.auth import AuthenticationError, AuthServiceDependency, JWTPayloadData

auth_router = APIRouter(prefix="/v1.0/auth", tags=["Authentication"])

logger = logging.getLogger(__name__)


def set_auth_cookie(response: Response, token: str, cookie_name: str) -> None:
    """Set the auth cookie."""
    response.set_cookie(
        key=cookie_name,
        value=token,
        httponly=True,
        secure=app_settings.jwt.cookie_secure,
        samesite="lax",
        domain=app_settings.jwt.cookie_domain,
        max_age=(
            app_settings.jwt.access_token_expire_minutes * 60
            if cookie_name == "access_token"
            else app_settings.jwt.refresh_token_expire_days * 86400
        ),
        path="/",
    )


@auth_router.post("/register", response_model=User, status_code=status.HTTP_201_CREATED)
def register(
    user_data: RegisterDTO,
    response: Response,
    db: DatabaseSession,
    auth_service: AuthServiceDependency,
):
    """Register a new user."""
    try:
        user = auth_service.register_user(
            email=user_data.email,
            password=user_data.password,
        )

    except AuthenticationError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        ) from None
    except Exception:
        db.rollback()
        raise

    access_token = auth_service.create_access_token(data=JWTPayloadData(sub=str(user.id), type="access"))
    set_auth_cookie(response, access_token, "access_token")

    db.commit()
    return User(
        id=user.id,
        email=user.email,
    )


@auth_router.post("/login", response_model=None)
def login(
    response: Response,
    auth_service: AuthServiceDependency,
    login_data: LoginDTO,
):
    """Login user and set JWT cookies."""
    try:
        user = auth_service.authenticate_user(email=login_data.email, password=login_data.password)
    except AuthenticationError as err:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        ) from err

    # Create access token
    access_token = auth_service.create_access_token(data=JWTPayloadData(sub=str(user.id), type="access"))
    set_auth_cookie(response, access_token, "access_token")

    # Create refresh token if "Remember Me" is enabled
    if login_data.remember_me:
        refresh_token = auth_service.create_refresh_token(data=JWTPayloadData(sub=str(user.id), type="refresh"))
        set_auth_cookie(response, refresh_token, "refresh_token")

    return {"message": "Successfully logged in"}


@auth_router.post("/refresh-token", response_model=None)
def refresh_token(request: Request, response: Response, auth_service: AuthServiceDependency):
    """Refresh the access token using the refresh token."""
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is missing",
        )

    try:
        # Decode and validate the refresh token
        payload = jwt.decode(refresh_token, app_settings.jwt.secret, algorithms=[app_settings.jwt.algorithm])
        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type",
            )

        # Create a new access token
        new_access_token = auth_service.create_access_token(data=JWTPayloadData(sub=payload.get("sub"), type="access"))
        set_auth_cookie(response, new_access_token, "access_token")

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has expired",
        ) from None
    except jwt.InvalidTokenError as err:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        ) from err
    else:
        return {"message": "Token refreshed"}


@auth_router.post("/logout", response_model=None)
def logout(response: Response):
    """Logout user by clearing the auth cookie."""
    response.delete_cookie(key="access_token", path="/", domain=app_settings.jwt.cookie_domain)
    response.delete_cookie(key="refresh_token", path="/", domain=app_settings.jwt.cookie_domain)
    return {"message": "Successfully logged out"}
