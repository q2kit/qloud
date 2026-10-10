"""Worker-only derived previews; no quota changes or application-server byte proxy."""

import logging
import math
import uuid
from contextlib import closing
from io import BytesIO
from threading import Lock
from typing import cast

import pypdfium2 as pdfium
from django.conf import settings
from django.db.models import F
from PIL import Image, ImageOps, UnidentifiedImageError

from apps.storage import s3

from .models import FileVersion, Node
from .video_thumbnails import frame

logger = logging.getLogger(__name__)
SIZES = (256, 1024)
# PDFium is not thread-safe, including eager tasks in Django's threaded E2E server.
_PDFIUM_LOCK = Lock()
IMAGE_FORMATS = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/gif": "GIF",
    "image/webp": "WEBP",
    "image/avif": "AVIF",
}


def supported(mime_type: str) -> bool:
    return mime_type in IMAGE_FORMATS or mime_type in {"application/pdf", "video/mp4"}


def thumbnail_key(version_id: uuid.UUID, size: int) -> str:
    return f"thumbs/{version_id}/{size}.webp"


def _image(source: bytes, mime_type: str) -> Image.Image:
    if mime_type == "video/mp4":
        return frame(source)
    if mime_type == "application/pdf":
        with _PDFIUM_LOCK, pdfium.PdfDocument(source) as document, closing(document[0]) as page:
            width, height = page.get_size()
            if not all(math.isfinite(value) and value > 0 for value in (width, height)):
                raise ValueError("invalid PDF page dimensions")
            # Render only page one directly at the largest output resolution.
            with closing(page.render(scale=SIZES[-1] / max(width, height))) as bitmap:
                return cast(Image.Image, bitmap.to_pil().copy())
    with Image.open(BytesIO(source), formats=[IMAGE_FORMATS[mime_type]]) as image:
        if image.width * image.height > settings.THUMBNAIL_MAX_PIXELS:
            raise ValueError("image exceeds thumbnail pixel limit")
        image.seek(0)
        return ImageOps.exif_transpose(image).convert("RGBA")


def generate(version_id: uuid.UUID) -> bool:
    version = (
        FileVersion.objects.select_related("blob", "node")
        .filter(pk=version_id, node__current_version_id=F("id"), node__trashed_at__isnull=True)
        .first()
    )
    if version is None or not supported(version.mime_type):
        return False
    key = thumbnail_key(version.pk, SIZES[0])
    if version.node.thumbnail_key == key:
        return False
    if version.blob.size > settings.THUMBNAIL_MAX_SOURCE_BYTES:
        return False
    try:
        source = s3.read_object(
            version.blob.storage_key, max_bytes=settings.THUMBNAIL_MAX_SOURCE_BYTES
        )
        with _image(source, version.mime_type) as image:
            for size in reversed(SIZES):
                image.thumbnail((size, size), Image.Resampling.LANCZOS)
                with BytesIO() as output:
                    image.save(output, format="WEBP", quality=85)
                    s3.put_object(thumbnail_key(version.pk, size), output.getvalue(), "image/webp")
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        pdfium.PdfiumError,
        OSError,
        ValueError,
        IndexError,
        TypeError,
    ) as error:
        logger.info("Skipping thumbnail for version %s: %s", version_id, error)
        return False
    # A replaced/deleted version must never overwrite the current thumbnail.
    # Neither thumbnail creation nor publication changes a file's updated_at.
    return bool(
        Node.objects.filter(
            pk=version.node_id, current_version_id=version.pk, trashed_at__isnull=True
        ).update(thumbnail_key=key)
    )
