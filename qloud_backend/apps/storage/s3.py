"""The only module that talks to object storage (architecture.md, ADR-0003).

Works with any S3-compatible service: AWS S3, Cloudflare R2, LocalStack in dev and CI
differ only in settings. File bytes never pass through here; browsers use the
presigned URLs directly.
"""

import functools
import math
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING
from urllib.parse import quote

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

MiB = 1024 * 1024
MIN_PART_SIZE = 8 * MiB  # upload.md; S3 itself allows 5 MiB
MAX_PARTS = 10_000  # S3 limit
MAX_PART_SIZE = 5 * 1024 * MiB  # S3 limit
DELETE_BATCH = 1000  # S3 DeleteObjects limit


class StorageError(Exception):
    """Object storage failed or refused a request; `code` is the S3 error code if any."""

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Part:
    number: int
    size: int
    etag: str


@dataclass(frozen=True)
class ObjectInfo:
    size: int
    etag: str


@functools.cache
def client() -> S3Client:
    """One client per process: it holds no request state, so servers stay stateless."""
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        region_name=settings.S3_REGION,
        aws_access_key_id=settings.S3_ACCESS_KEY_ID,
        aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": settings.S3_ADDRESSING_STYLE},
            connect_timeout=5,
            read_timeout=30,
            retries={"mode": "standard", "max_attempts": 3},
        ),
    )


def _bucket() -> str:
    return str(settings.S3_BUCKET)


def _error(error: ClientError | BotoCoreError) -> StorageError:
    if isinstance(error, ClientError):
        code = error.response.get("Error", {}).get("Code")
        return StorageError(str(error), code=code)
    return StorageError(str(error))


def new_blob_key() -> str:
    """Keys never contain file names: renames stay metadata-only and names stay private."""
    return f"blobs/{uuid.uuid7()}"


def part_size_for(size: int) -> int:
    """Smallest part size, from 8 MiB in whole MiB, that keeps `size` within 10,000 parts."""
    if size < 0:
        raise ValueError("size must not be negative")
    part = max(MIN_PART_SIZE, math.ceil(size / MAX_PARTS / MiB) * MiB)
    if part > MAX_PART_SIZE:
        raise ValueError("size exceeds what one multipart upload can hold")
    return part


def part_count(size: int, part_size: int) -> int:
    return max(1, math.ceil(size / part_size))


def create_multipart_upload(key: str, content_type: str) -> str:
    """Start a multipart upload; returns its upload id."""
    try:
        response = client().create_multipart_upload(
            Bucket=_bucket(), Key=key, ContentType=content_type
        )
    except (ClientError, BotoCoreError) as error:
        raise _error(error) from error
    return response["UploadId"]


def presign_upload_part(key: str, upload_id: str, part_number: int) -> str:
    """A URL the browser PUTs one part to; S3 answers with the part's ETag header."""
    if not 1 <= part_number <= MAX_PARTS:
        raise ValueError("part_number must be between 1 and 10000")
    return client().generate_presigned_url(
        "upload_part",
        Params={
            "Bucket": _bucket(),
            "Key": key,
            "UploadId": upload_id,
            "PartNumber": part_number,
        },
        ExpiresIn=settings.S3_UPLOAD_PART_URL_SECONDS,
    )


def list_parts(key: str, upload_id: str) -> list[Part]:
    """Every uploaded part, in order. S3 returns at most 1,000 per request."""
    parts: list[Part] = []
    marker = 0
    try:
        while True:
            response = client().list_parts(
                Bucket=_bucket(), Key=key, UploadId=upload_id, PartNumberMarker=marker
            )
            parts += [
                Part(number=p["PartNumber"], size=p["Size"], etag=p["ETag"])
                for p in response.get("Parts", [])
            ]
            if not response.get("IsTruncated"):
                return parts
            marker = int(response["NextPartNumberMarker"])
    except (ClientError, BotoCoreError) as error:
        raise _error(error) from error


def complete_multipart_upload(key: str, upload_id: str, parts: Sequence[Part]) -> str:
    """Assemble the parts into the object; returns its ETag."""
    try:
        response = client().complete_multipart_upload(
            Bucket=_bucket(),
            Key=key,
            UploadId=upload_id,
            MultipartUpload={
                "Parts": [{"PartNumber": part.number, "ETag": part.etag} for part in parts]
            },
        )
    except (ClientError, BotoCoreError) as error:
        raise _error(error) from error
    return response["ETag"]


def abort_multipart_upload(key: str, upload_id: str) -> None:
    """Drop the upload and its parts. Safe to repeat: an unknown upload is already gone."""
    try:
        client().abort_multipart_upload(Bucket=_bucket(), Key=key, UploadId=upload_id)
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") != "NoSuchUpload":
            raise _error(error) from error
    except BotoCoreError as error:
        raise _error(error) from error


def put_empty_object(key: str, content_type: str) -> str:
    """0-byte files: S3 refuses a multipart upload with no parts (upload.md)."""
    try:
        response = client().put_object(
            Bucket=_bucket(), Key=key, Body=b"", ContentType=content_type
        )
    except (ClientError, BotoCoreError) as error:
        raise _error(error) from error
    return response["ETag"]


def head_object(key: str) -> ObjectInfo:
    try:
        response = client().head_object(Bucket=_bucket(), Key=key)
    except (ClientError, BotoCoreError) as error:
        raise _error(error) from error
    return ObjectInfo(size=response["ContentLength"], etag=response["ETag"])


def content_disposition(filename: str, *, inline: bool = False) -> str:
    """RFC 6266: an ASCII fallback plus the exact UTF-8 name (RFC 5987) for any browser."""
    kind = "inline" if inline else "attachment"
    fallback = "".join(
        c if c.isascii() and c.isprintable() and c not in '"\\' else "_" for c in filename
    )
    return f"{kind}; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


def presign_download(key: str, *, filename: str, content_type: str, inline: bool = False) -> str:
    """A short-lived GET URL; S3 serves Range requests, so video streams from it."""
    return client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": _bucket(),
            "Key": key,
            "ResponseContentDisposition": content_disposition(filename, inline=inline),
            "ResponseContentType": content_type,
        },
        ExpiresIn=settings.S3_DOWNLOAD_URL_SECONDS,
    )


def delete_objects(keys: Iterable[str]) -> None:
    """Delete objects in batches of 1,000; missing keys are not an error."""
    batch: list[str] = []
    for key in keys:
        batch.append(key)
        if len(batch) == DELETE_BATCH:
            _delete_batch(batch)
            batch = []
    if batch:
        _delete_batch(batch)


def _delete_batch(keys: list[str]) -> None:
    try:
        response = client().delete_objects(
            Bucket=_bucket(),
            Delete={"Objects": [{"Key": key} for key in keys], "Quiet": True},
        )
    except (ClientError, BotoCoreError) as error:
        raise _error(error) from error
    if errors := response.get("Errors"):
        first = errors[0]
        raise StorageError(
            f"{len(errors)} object(s) not deleted, e.g. {first.get('Key')}: {first.get('Message')}",
            code=first.get("Code"),
        )
