"""S3 service."""

from typing import Annotated, Any, BinaryIO, Literal

import boto3
from botocore.client import Config
from botocore.exceptions import NoCredentialsError, PartialCredentialsError
from fastapi import Depends

from src.app.config import app_settings

type PathPrefix = Literal["public", "private"]


class S3Service:
    """Manages public and private file storage in S3."""

    def __init__(self) -> None:
        """S3Service."""
        self._client: Any = boto3.client(  # type: ignore[reportUnknownMemberType]
            "s3",
            config=Config(signature_version="s3v4"),
            endpoint_url=app_settings.s3.minio_endpoint_url,
            aws_access_key_id=app_settings.s3.minio_access_key_id,
            aws_secret_access_key=app_settings.s3.minio_secret_access_key,
        )
        self._bucket = app_settings.s3.bucket

    def _key(self, prefix: PathPrefix, key: str) -> str:
        return f"{prefix}/{key}"

    def _upload(self, *, file: BinaryIO, prefix: PathPrefix, key: str, content_type: str | None) -> None:
        try:
            self._client.upload_fileobj(
                file,
                Bucket=self._bucket,
                Key=self._key(prefix, key),
                ExtraArgs={"ContentType": content_type} if content_type else {},
            )
        except (NoCredentialsError, PartialCredentialsError) as err:
            raise S3CredentialsError from err

    def _get(self, *, prefix: PathPrefix, key: str) -> Any:
        try:
            response: Any = self._client.get_object(Bucket=self._bucket, Key=self._key(prefix, key))
        except (NoCredentialsError, PartialCredentialsError) as err:
            raise S3CredentialsError from err
        return response["Body"]

    def _delete(self, *, prefix: PathPrefix, key: str) -> None:
        try:
            self._client.delete_object(Bucket=self._bucket, Key=self._key(prefix, key))
        except (NoCredentialsError, PartialCredentialsError) as err:
            raise S3CredentialsError from err

    def upload_public_file(self, *, file: BinaryIO, content_type: str | None, key: str) -> None:
        """Upload a publicly accessible file (served at public/{key})."""
        self._upload(file=file, prefix="public", key=key, content_type=content_type)

    def upload_private_file(self, *, file: BinaryIO, content_type: str | None, key: str) -> None:
        """Upload a private file (accessible only to authorized services)."""
        self._upload(file=file, prefix="private", key=key, content_type=content_type)

    def get_public_object(self, *, key: str) -> Any:
        """Return the streaming body for a public object."""
        return self._get(prefix="public", key=key)

    def get_private_object(self, *, key: str) -> Any:
        """Return the streaming body for a private object."""
        return self._get(prefix="private", key=key)

    def delete_public_file(self, *, key: str) -> None:
        """Delete a public file."""
        self._delete(prefix="public", key=key)

    def delete_private_file(self, *, key: str) -> None:
        """Delete a private file."""
        self._delete(prefix="private", key=key)

    def generate_presigned_url(self, *, key: str, prefix: PathPrefix, expires_in: int = 3600) -> str:
        """Generate a pre-signed URL for temporary access to any object."""
        url: str = self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": self._key(prefix, key)},
            ExpiresIn=expires_in,
        )
        return url

    def get_public_url(self, *, key: str) -> str:
        """Build the permanent public URL for a public object."""
        return app_settings.s3.url_template.format(bucket=self._bucket, key=self._key("public", key))


class S3CredentialsError(Exception):
    """Raised when S3 credentials are missing or invalid."""

    def __init__(self) -> None:
        """Initialize."""
        super().__init__("S3 credentials error.")


def _get_s3_service() -> S3Service:
    return S3Service()


S3ServiceDependency = Annotated[S3Service, Depends(_get_s3_service)]
