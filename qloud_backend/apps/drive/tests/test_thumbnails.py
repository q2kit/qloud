import uuid
from io import BytesIO
from typing import Any, cast
from unittest.mock import Mock

import pypdfium2 as pdfium
import pytest
from allauth.account.models import EmailAddress
from billiard.exceptions import SoftTimeLimitExceeded
from celery.exceptions import Retry
from django.db import transaction
from kombu.exceptions import OperationalError
from PIL import Image

from apps.drive import tasks, thumbnails
from apps.drive.models import Node
from apps.storage import s3
from apps.uploads import services
from apps.uploads.tests.conftest import put

pytestmark = pytest.mark.django_db


def picture(size: tuple[int, int] = (1600, 800), format: str = "PNG", **kwargs: Any) -> bytes:
    with BytesIO() as output, Image.new("RGB", size, "red") as image:
        image.save(output, format=format, **kwargs)
        return output.getvalue()


@pytest.fixture
def source_file(make_file, bucket):
    def make(data=None, mime="image/png"):
        data = picture() if data is None else data
        node = make_file(size=len(data))
        version = node.current_version
        version.mime_type = mime
        version.save()
        node.mime_type = mime
        node.save()
        s3.put_object(version.blob.storage_key, data, mime)
        return node, version

    return make


@pytest.fixture
def upload_session(user, root, bucket):
    EmailAddress.objects.create(user=user, email=user.email, primary=True, verified=True)
    data = picture((32, 16))
    session = services.create_session(
        user,
        parent_id=root.pk,
        filename="photo.png",
        size=len(data),
        mime_type="image/png",
        fingerprint="photo",
    )
    put(s3.presign_upload_part(session.storage_key, session.s3_upload_id, 1), data)
    return session


def test_webp_dimensions_content_metadata_and_quota(source_file, user):
    node, version = source_file()
    original_time = node.updated_at
    counters = (user.used_bytes, user.reserved_bytes)
    assert tasks.generate_thumbnail.delay(str(version.pk)).get() is True
    for size in thumbnails.SIZES:
        key = thumbnails.thumbnail_key(version.pk, size)
        data = s3.read_object(key, max_bytes=100_000)
        with Image.open(BytesIO(data)) as image:
            assert image.format == "WEBP"
            assert image.size == (size, size // 2)
            red, green, blue = cast(tuple[int, int, int], image.convert("RGB").getpixel((0, 0)))
            assert red > 240
            assert green < 10
            assert blue < 10
        assert s3.client().head_object(Bucket=s3._bucket(), Key=key)["ContentType"] == "image/webp"
    node.refresh_from_db()
    user.refresh_from_db()
    assert node.thumbnail_key == thumbnails.thumbnail_key(version.pk, 256)
    assert node.updated_at == original_time
    assert (user.used_bytes, user.reserved_bytes) == counters


@pytest.mark.parametrize(
    ("format", "mime"), [("PNG", "image/png"), ("WEBP", "image/webp"), ("AVIF", "image/avif")]
)
def test_small_image_is_not_upscaled(source_file, format, mime):
    _, version = source_file(picture((32, 16), format), mime)
    assert thumbnails.generate(version.pk)
    for size in thumbnails.SIZES:
        with Image.open(
            BytesIO(s3.read_object(thumbnails.thumbnail_key(version.pk, size), max_bytes=10000))
        ) as image:
            assert image.size == (32, 16)


def test_exif_rotation(source_file):
    exif = Image.Exif()
    exif[274] = 6
    _, version = source_file(picture(format="JPEG", exif=exif), "image/jpeg")
    assert thumbnails.generate(version.pk)
    with Image.open(
        BytesIO(s3.read_object(thumbnails.thumbnail_key(version.pk, 256), max_bytes=10000))
    ) as image:
        assert image.size == (128, 256)
        assert not image.getexif()


def test_gif_uses_first_frame(source_file):
    with Image.new("RGB", (64, 32), "blue") as second:
        data = picture((64, 32), "GIF", save_all=True, append_images=[second])
    _, version = source_file(data, "image/gif")
    assert thumbnails.generate(version.pk)
    with Image.open(
        BytesIO(s3.read_object(thumbnails.thumbnail_key(version.pk, 256), max_bytes=10000))
    ) as image:
        assert cast(tuple[int, int, int], image.convert("RGB").getpixel((0, 0)))[0] > 240
        assert not getattr(image, "is_animated", False)


def test_pdf_renders_only_first_page(source_file):
    with (
        BytesIO() as output,
        Image.new("RGB", (600, 300), "red") as first,
        Image.new("RGB", (600, 300), "blue") as second,
    ):
        first.save(output, format="PDF", save_all=True, append_images=[second])
        _, version = source_file(output.getvalue(), "application/pdf")
    assert thumbnails.generate(version.pk)
    for size in thumbnails.SIZES:
        with Image.open(
            BytesIO(s3.read_object(thumbnails.thumbnail_key(version.pk, size), max_bytes=10000))
        ) as image:
            assert image.size == (size, size // 2)
            assert (
                cast(tuple[int, int, int], image.convert("RGB").getpixel((size // 2, size // 4)))[0]
                > 240
            )


@pytest.mark.parametrize(
    ("mime", "data"),
    [
        ("image/png", b"corrupt"),
        ("application/pdf", b"corrupt"),
        ("image/svg+xml", b"<svg/>"),
        ("text/html", b"<script/>"),
        ("image/png", picture(format="JPEG")),
    ],
)
def test_invalid_or_unsupported_source_has_no_thumbnail(source_file, mime, data):
    node, version = source_file(data, mime)
    assert thumbnails.generate(version.pk) is False
    node.refresh_from_db()
    assert node.thumbnail_key is None


def test_pdf_password_error_falls_back_to_icon(source_file, monkeypatch):
    node, version = source_file(b"password protected PDF", "application/pdf")
    monkeypatch.setattr(
        pdfium,
        "PdfDocument",
        Mock(side_effect=pdfium.PdfiumError("Incorrect password")),
    )
    assert thumbnails.generate(version.pk) is False
    node.refresh_from_db()
    assert node.thumbnail_key is None


def test_transparency_is_preserved(source_file):
    with BytesIO() as output, Image.new("RGBA", (32, 16), (0, 0, 0, 0)) as image:
        image.save(output, format="PNG")
        _, version = source_file(output.getvalue())
    assert thumbnails.generate(version.pk)
    data = s3.read_object(thumbnails.thumbnail_key(version.pk, 256), max_bytes=10000)
    with Image.open(BytesIO(data)) as image:
        assert image.getextrema()[-1] == (0, 0)


def test_limits_reject_source_before_decode(source_file, settings, monkeypatch):
    node, version = source_file()
    settings.THUMBNAIL_MAX_SOURCE_BYTES = version.size - 1
    read = Mock(side_effect=AssertionError("oversized source must not be read"))
    monkeypatch.setattr(s3, "read_object", read)
    assert thumbnails.generate(version.pk) is False
    read.assert_not_called()
    settings.THUMBNAIL_MAX_SOURCE_BYTES = version.size + 1
    monkeypatch.setattr(s3, "read_object", lambda *args, **kwargs: picture())
    settings.THUMBNAIL_MAX_PIXELS = 100
    assert thumbnails.generate(version.pk) is False
    node.refresh_from_db()
    assert node.thumbnail_key is None


def test_safe_to_repeat_and_skips_missing_trashed_or_old_version(source_file, monkeypatch):
    node, version = source_file()
    assert thumbnails.generate(version.pk)
    read = Mock(side_effect=AssertionError("must not read source again"))
    monkeypatch.setattr(s3, "read_object", read)
    assert thumbnails.generate(version.pk) is False
    assert thumbnails.generate(uuid.uuid7()) is False
    Node.objects.filter(pk=node.pk).update(current_version=None, thumbnail_key=None)
    assert thumbnails.generate(version.pk) is False
    from django.utils import timezone

    Node.objects.filter(pk=node.pk).update(
        current_version=version, trashed_at=timezone.now(), trashed_root=node
    )
    assert thumbnails.generate(version.pk) is False


def test_version_replaced_while_rendering_is_not_published(source_file, monkeypatch):
    node, version = source_file()
    write = s3.put_object

    def replace(*args):
        Node.objects.filter(pk=node.pk).update(current_version=None)
        write(*args)

    monkeypatch.setattr(s3, "put_object", replace)
    assert thumbnails.generate(version.pk) is False
    node.refresh_from_db()
    assert node.thumbnail_key is None


def test_partial_write_is_not_published_and_retry_finishes(source_file, monkeypatch):
    node, version = source_file()
    write = s3.put_object

    def fail_small(key, *args):
        if key.endswith("/256.webp"):
            raise s3.StorageError("unavailable")
        write(key, *args)

    monkeypatch.setattr(s3, "put_object", fail_small)
    with pytest.raises(s3.StorageError):
        thumbnails.generate(version.pk)
    node.refresh_from_db()
    assert node.thumbnail_key is None
    monkeypatch.setattr(s3, "put_object", write)
    assert thumbnails.generate(version.pk)


def test_task_retries_storage_failure_and_handles_soft_timeout(monkeypatch):
    def failure(version_id):
        raise s3.StorageError("temporarily unavailable")

    monkeypatch.setattr(thumbnails, "generate", failure)
    with pytest.raises(Retry):
        tasks.generate_thumbnail.apply(args=(str(uuid.uuid7()),), throw=True)

    def timeout(version_id):
        raise SoftTimeLimitExceeded()

    monkeypatch.setattr(thumbnails, "generate", timeout)
    assert tasks.generate_thumbnail.run(str(uuid.uuid7())) is False
    assert tasks.generate_thumbnail.max_retries == 3
    assert tasks.generate_thumbnail.soft_time_limit == 60
    assert tasks.generate_thumbnail.time_limit == 90


def test_upload_enqueues_only_after_commit_once(
    user, upload_session, django_capture_on_commit_callbacks, monkeypatch
):
    enqueue = Mock()
    monkeypatch.setattr(services, "enqueue_thumbnail", enqueue)
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        node = services.complete(user, upload_session)
        enqueue.assert_not_called()
    assert len(callbacks) == 1
    enqueue.assert_called_once_with(str(node.current_version_id))
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        assert services.complete(user, upload_session).pk == node.pk
    assert callbacks == []
    assert enqueue.call_count == 1


def test_rollback_does_not_enqueue(
    user, upload_session, django_capture_on_commit_callbacks, monkeypatch
):
    enqueue = Mock()
    monkeypatch.setattr(services, "enqueue_thumbnail", enqueue)

    def rollback() -> None:
        with transaction.atomic():
            services.complete(user, upload_session)
            raise RuntimeError("rollback")

    with (
        django_capture_on_commit_callbacks(execute=True) as callbacks,
        pytest.raises(RuntimeError, match="rollback"),
    ):
        rollback()
    assert callbacks == []
    enqueue.assert_not_called()


def test_committed_upload_generates_thumbnail(
    user, upload_session, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        node = services.complete(user, upload_session)
        assert node.thumbnail_key is None
    node.refresh_from_db()
    assert node.current_version_id is not None
    assert node.thumbnail_key == thumbnails.thumbnail_key(node.current_version_id, 256)
    user.refresh_from_db()
    assert user.used_bytes == upload_session.size
    assert user.reserved_bytes == 0


def test_broker_outage_does_not_break_committed_upload(monkeypatch, caplog):
    monkeypatch.setattr(
        tasks.generate_thumbnail, "delay", Mock(side_effect=OperationalError("down"))
    )
    tasks.enqueue_thumbnail(str(uuid.uuid7()))
    assert "Could not enqueue thumbnail" in caplog.text
