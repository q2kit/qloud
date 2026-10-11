"""Preview links for permission-checked nodes; source bytes stay on S3."""

import datetime
from dataclasses import dataclass
from typing import Literal

from django.conf import settings
from django.http import Http404
from django.utils import timezone

from apps.storage import s3

from .downloads import OPAQUE, safe_content_type
from .errors import NotAFile
from .models import FileVersion, Node

PreviewKind = Literal["image", "pdf", "video", "audio", "text", "unsupported"]
_IMAGE = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"}
_VIDEO = {"video/mp4", "video/webm"}
_AUDIO = {"audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg"}
_TEXT = {
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "text/csv",
    "application/json",
    "text/x-python",
    "text/x-c",
    "text/x-c++",
    "text/x-java-source",
    "text/x-go",
    "text/x-rust",
    "text/x-shellscript",
    "application/x-sh",
    "application/x-python-code",
    "text/css",
    "text/x-typescript",
    "application/typescript",
}
TEXT_MAX_BYTES = 1_000_000


def preview_kind(mime_type: str, size: int) -> PreviewKind:
    mime = safe_content_type(mime_type)
    if mime == OPAQUE:
        return "unsupported"
    if mime in _IMAGE:
        return "image"
    if mime == "application/pdf":
        return "pdf"
    if mime in _VIDEO:
        return "video"
    if mime in _AUDIO:
        return "audio"
    if mime in _TEXT and size < TEXT_MAX_BYTES:
        return "text"
    return "unsupported"


@dataclass(frozen=True)
class ThumbnailLink:
    url: str
    large_url: str
    expires_at: datetime.datetime


@dataclass(frozen=True)
class PreviewLink:
    kind: PreviewKind
    url: str | None
    expires_at: datetime.datetime | None
    thumbnail: ThumbnailLink | None


def preview_link(
    node: Node, *, thumbnail_only: bool = False, expires_in: int | None = None
) -> PreviewLink:
    if node.kind != Node.Kind.FILE:
        raise NotAFile
    if node.current_version_id is None:
        raise Http404
    version = FileVersion.objects.select_related("blob").get(pk=node.current_version_id)
    kind = preview_kind(version.mime_type, version.size)
    ttl = expires_in if expires_in is not None else settings.S3_DOWNLOAD_URL_SECONDS
    expires_at = timezone.now() + datetime.timedelta(seconds=ttl)
    url = None
    if not thumbnail_only and kind != "unsupported":
        url = s3.presign_download(
            version.blob.storage_key,
            filename=node.name,
            content_type="text/plain" if kind == "text" else safe_content_type(version.mime_type),
            inline=True,
            expires_in=ttl,
        )
    thumbnail = None
    # Only publish the pair belonging to this version, never an old version's key.
    prefix = f"thumbs/{version.pk}"
    if (
        kind in {"image", "pdf"} or safe_content_type(version.mime_type) == "video/mp4"
    ) and node.thumbnail_key == f"{prefix}/256.webp":
        thumbnail = ThumbnailLink(
            url=s3.presign_download(
                node.thumbnail_key,
                filename="256.webp",
                content_type="image/webp",
                inline=True,
                expires_in=ttl,
            ),
            large_url=s3.presign_download(
                f"{prefix}/1024.webp",
                filename="1024.webp",
                content_type="image/webp",
                inline=True,
                expires_in=ttl,
            ),
            expires_at=expires_at,
        )
    return PreviewLink(kind, url, expires_at if url else None, thumbnail)
