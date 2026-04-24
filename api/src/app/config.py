"""Application configuration."""

import logging
from typing import Any, Literal, cast

from pydantic import Field, HttpUrl, field_validator, model_validator
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class DatabaseSettings(BaseSettings, env_prefix="DB_"):
    """Database settings."""

    name: str = Field(default=...)
    user: str = Field(default=...)
    host: str = Field(default=...)
    port: int = 5432
    password: str = Field(default=...)
    echo: bool = False

    @property
    def db_url(self) -> str:
        """Database string based on inputs."""
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.name}"


class JWTSettings(BaseSettings, env_prefix="JWT_"):
    """JWT authentication settings."""

    secret: str = Field(default=...)
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30
    cookie_secure: bool = False
    cookie_domain: str | None = None


class CORSSettings(BaseSettings, env_prefix="CORS_"):
    """CORS settings."""

    allowed_origins: list[HttpUrl] = Field(default_factory=lambda: cast(list[HttpUrl], []))


class CelerySettings(BaseSettings, env_prefix="CELERY_"):
    """Celery settings."""

    broker_url: str = "amqp://rabbitmq:5672"


class S3Settings(BaseSettings, env_prefix="S3_"):
    """S3 settings."""

    bucket: str = "terramaps"
    url_template: str = "https://{bucket}.s3.us-east-1.amazonaws.com/{key}"

    # Only set for local development (MinIO override).
    minio_endpoint_url: str | None = Field(default=None)
    minio_access_key_id: str | None = Field(default=None)
    minio_secret_access_key: str | None = Field(default=None)

    @field_validator("url_template")
    @classmethod
    def validate_url_template(cls, value: Any) -> Any:
        """Ensure url_template contains {bucket} and {key} placeholders."""
        if not isinstance(value, str):
            raise ValueError("url_template must be a string.")  # noqa: TRY003
        if "{bucket}" not in value or "{key}" not in value:
            raise ValueError("url_template must contain both {bucket} and {key} placeholders.")  # noqa: TRY003
        return value

    @model_validator(mode="after")
    def validate_minio_settings(self) -> "S3Settings":
        """Ensure all-or-nothing on minio overrides and warn when active."""
        minio_fields = [self.minio_endpoint_url, self.minio_access_key_id, self.minio_secret_access_key]
        configured = [f is not None for f in minio_fields]
        if any(configured) and not all(configured):
            raise ValueError(  # noqa: TRY003
                "Set all three S3_MINIO_* vars (endpoint_url, access_key_id, secret_access_key) or none."
            )
        if all(configured):
            logger.warning("MinIO S3 override is active — local development only.")
        return self


class AppSettings(BaseSettings):
    """Application settings."""

    debug: bool = False
    database: DatabaseSettings = DatabaseSettings()
    jwt: JWTSettings = JWTSettings()
    cors: CORSSettings = CORSSettings()
    celery: CelerySettings = CelerySettings()
    s3: S3Settings = S3Settings()
    log_level: Literal["CRITICAL", "FATAL", "ERROR", "WARNING", "INFO", "DEBUG", "NOTSET"] = "INFO"


app_settings = AppSettings()
