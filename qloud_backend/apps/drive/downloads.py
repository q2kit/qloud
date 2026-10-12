"""Download links (download-preview.md). Bytes go from S3 to the browser directly."""

import datetime
from dataclasses import dataclass

from django.conf import settings
from django.http import Http404
from django.utils import timezone

from apps.storage import s3

from .errors import NotAFile
from .models import FileVersion, Node

# Types a browser could run script in if it ever rendered them; served as opaque bytes.
_SCRIPTABLE = {
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "text/xml",
    "application/xml",
    "text/javascript",
    "application/javascript",
}
OPAQUE = "application/octet-stream"


def safe_content_type(mime_type: str) -> str:
    mime = mime_type.split(";")[0].strip().lower()
    if mime in _SCRIPTABLE or mime.endswith("+xml") or "javascript" in mime:
        return OPAQUE
    return mime or OPAQUE


@dataclass(frozen=True)
class DownloadLink:
    url: str
    expires_at: datetime.datetime


def download_link(node: Node, *, expires_in: int | None = None) -> DownloadLink:
    """For the current version, under the node's current name. `node` is permission-checked."""
    if node.kind != Node.Kind.FILE:
        raise NotAFile
    if node.current_version_id is None:  # not possible for a completed upload
        raise Http404
    version = FileVersion.objects.select_related("blob").get(pk=node.current_version_id)
    return version_download_link(node, version, expires_in=expires_in)


def version_download_link(
    node: Node, version: FileVersion, *, expires_in: int | None = None
) -> DownloadLink:
    """The caller has checked access and that the version belongs to this file."""
    ttl = expires_in if expires_in is not None else settings.S3_DOWNLOAD_URL_SECONDS
    expires_at = timezone.now() + datetime.timedelta(seconds=ttl)
    url = s3.presign_download(
        version.blob.storage_key,
        filename=node.name,
        content_type=safe_content_type(version.mime_type),
        expires_in=ttl,
    )
    return DownloadLink(url=url, expires_at=expires_at)
