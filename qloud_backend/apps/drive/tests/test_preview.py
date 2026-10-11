import datetime
import io
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from django.utils import timezone
from PIL import Image

from apps.accounts.models import User
from apps.drive.models import Node
from apps.drive.previews import preview_kind
from apps.drive.thumbnails import generate

from .test_download import fetch

pytestmark = pytest.mark.django_db


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user)
    return api_client


def preview(node: Node) -> str:
    return f"/api/v1/nodes/{node.pk}/preview"


@pytest.mark.parametrize(
    ("mime", "kind", "served"),
    [
        ("image/jpeg", "image", "image/jpeg"),
        ("image/png", "image", "image/png"),
        ("image/gif", "image", "image/gif"),
        ("image/webp", "image", "image/webp"),
        ("image/avif", "image", "image/avif"),
        ("application/pdf", "pdf", "application/pdf"),
        ("video/mp4", "video", "video/mp4"),
        ("video/webm", "video", "video/webm"),
        ("audio/mpeg", "audio", "audio/mpeg"),
        ("audio/wav", "audio", "audio/wav"),
        ("audio/x-wav", "audio", "audio/x-wav"),
        ("audio/ogg", "audio", "audio/ogg"),
        ("text/plain", "text", "text/plain"),
        ("text/markdown", "text", "text/plain"),
        ("application/json", "text", "text/plain"),
        ("text/csv", "text", "text/plain"),
        ("text/x-python", "text", "text/plain"),
        ("text/css", "text", "text/plain"),
        (" IMAGE/PNG ; charset=utf-8", "image", "image/png"),
    ],
)
def test_preview_real_source(client, stored_file, mime, kind, served, django_assert_num_queries):
    node = stored_file("Ảnh mới.png", b"source bytes", mime)
    with django_assert_num_queries(2):
        response = client.get(preview(node))
    assert response.status_code == 200
    result = response.json()
    assert result["kind"] == kind
    assert result["thumbnail"] is None
    query = parse_qs(urlparse(result["url"]).query)
    assert query["X-Amz-Expires"] == ["300"]
    expiry = datetime.datetime.fromisoformat(result["expires_at"])
    assert (
        timezone.now() + datetime.timedelta(minutes=4)
        < expiry
        <= timezone.now() + datetime.timedelta(minutes=5)
    )
    with fetch(result["url"]) as content:
        assert content.read() == b"source bytes"
        assert content.headers["Content-Type"] == served
        assert content.headers["Content-Disposition"].startswith("inline;")
        assert (
            "filename*=UTF-8''%E1%BA%A2nh%20m%E1%BB%9Bi.png"
            in content.headers["Content-Disposition"]
        )


@pytest.mark.parametrize(
    "mime",
    [
        "text/html",
        "image/svg+xml",
        "application/xml",
        "text/xml",
        "application/xhtml+xml",
        "application/rss+xml",
        "text/javascript",
        "application/javascript",
        "application/x-javascript",
        "TEXT/HTML; charset=utf-8",
        "application/octet-stream",
        "image/heic",
        "text/unknown",
        "",
        "application/zip",
    ],
)
def test_unsupported_does_not_sign_a_url(client, stored_file, mime, monkeypatch):
    node = stored_file("misleading.png", b"<script>alert(1)</script>", mime)

    def refuse(*args, **kwargs):
        pytest.fail("unsupported MIME must not get a signed URL")

    monkeypatch.setattr("apps.drive.previews.s3.presign_download", refuse)
    result = client.get(preview(node))
    assert result.status_code == 200
    assert result.json() == {
        "kind": "unsupported",
        "url": None,
        "expires_at": None,
        "thumbnail": None,
    }


@pytest.mark.parametrize(
    ("size", "kind"), [(999_999, "text"), (1_000_000, "unsupported"), (1_000_001, "unsupported")]
)
def test_text_size_boundary(client, make_file, size, kind):
    node = make_file(size=size)
    assert client.get(preview(node)).json()["kind"] == kind


def test_access_checks(client, user, root, make_file):
    node = make_file()
    assert client.get(preview(root)).json()["error"]["code"] == "not_a_file"
    assert client.get(f"/api/v1/nodes/{uuid.uuid4()}/preview").status_code == 404
    client.force_authenticate(User.objects.create_user("stranger@example.com"))
    assert client.get(preview(node)).status_code == 404
    client.force_authenticate(user)
    Node.objects.filter(pk=node.pk).update(trashed_at=timezone.now(), trashed_root=node)
    assert client.get(preview(node)).status_code == 404
    client.force_authenticate(None)
    result = client.get(preview(node))
    assert (result.status_code, result.json()["error"]["code"]) == (403, "not_authenticated")


def test_missing_version(client, make_file):
    node = make_file()
    Node.objects.filter(pk=node.pk).update(current_version=None)
    assert client.get(preview(node)).status_code == 404


def test_current_version_metadata_and_current_name(client, make_file):
    node = make_file("old.txt", size=1_000_000)
    node.current_version.size = 3
    node.current_version.mime_type = "application/pdf"
    node.current_version.save()
    Node.objects.filter(pk=node.pk).update(name="new.pdf", mime_type="text/html")
    result = client.get(preview(node)).json()
    assert result["kind"] == "pdf"
    assert parse_qs(urlparse(result["url"]).query)["response-content-disposition"][0].startswith(
        'inline; filename="new.pdf"'
    )


@pytest.mark.parametrize(("format", "mime"), [("PNG", "image/png"), ("PDF", "application/pdf")])
def test_generated_thumbnail_urls(
    client, stored_file, django_assert_num_queries, monkeypatch, format, mime
):
    source = io.BytesIO()
    Image.new("RGB", (1500, 750), "red").save(source, format=format)
    node = stored_file("source", source.getvalue(), mime)
    assert generate(node.current_version_id)

    def refuse(*args, **kwargs):
        pytest.fail("preview requests must not read source bytes or generate thumbnails")

    monkeypatch.setattr("apps.storage.s3.read_object", refuse)
    monkeypatch.setattr("apps.drive.thumbnails.generate", refuse)
    with django_assert_num_queries(2):
        result = client.get(preview(node)).json()
    thumb = result["thumbnail"]
    assert thumb["expires_at"] == result["expires_at"]
    for field, size in [("url", (256, 128)), ("large_url", (1024, 512))]:
        assert parse_qs(urlparse(thumb[field]).query)["X-Amz-Expires"] == ["300"]
        with fetch(thumb[field]) as content:
            assert content.headers["Content-Type"] == "image/webp"
            assert content.headers["Content-Disposition"].startswith("inline;")
            with Image.open(io.BytesIO(content.read())) as image:
                assert image.size == size


def test_stale_thumbnail_is_not_exposed(client, make_file):
    node = make_file()
    node.current_version.mime_type = "image/png"
    node.current_version.save()
    Node.objects.filter(pk=node.pk).update(thumbnail_key=f"thumbs/{uuid.uuid4()}/256.webp")
    assert client.get(preview(node)).json()["thumbnail"] is None


@pytest.mark.parametrize(("format", "mime"), [("PNG", "image/png"), ("PDF", "application/pdf")])
def test_trash_thumbnail_never_signs_source(client, stored_file, monkeypatch, format, mime):
    source = io.BytesIO()
    Image.new("RGB", (800, 400), "red").save(source, format=format)
    node = stored_file("source", source.getvalue(), mime)
    assert generate(node.current_version_id)
    Node.objects.filter(pk=node.pk).update(trashed_at=timezone.now(), trashed_root=node)
    from apps.storage import s3

    sign = s3.presign_download
    keys = []

    def thumbnail_only(key, **kwargs):
        keys.append(key)
        assert key.startswith(f"thumbs/{node.current_version_id}/")
        return sign(key, **kwargs)

    monkeypatch.setattr(s3, "presign_download", thumbnail_only)
    result = client.get(preview(node), {"trashed_thumbnail": "true"})
    assert result.status_code == 200
    data = result.json()
    assert data["url"] is None
    assert data["expires_at"] is None
    assert len(keys) == 2
    with fetch(data["thumbnail"]["url"]) as content:
        assert content.headers["Content-Type"] == "image/webp"
        with Image.open(io.BytesIO(content.read())) as image:
            assert image.size == (256, 128)
    assert client.get(preview(node)).status_code == 404
    assert client.get(f"/api/v1/nodes/{node.pk}/download").status_code == 404


def test_trash_thumbnail_permissions_and_missing_data(client, make_file, root, user):
    node = make_file()
    query = {"trashed_thumbnail": "true"}
    assert client.get(preview(node), query).status_code == 404
    assert client.get(preview(node), {"trashed_thumbnail": "invalid"}).status_code == 400
    Node.objects.filter(pk=node.pk).update(trashed_at=timezone.now(), trashed_root=node)
    assert client.get(preview(node), query).json()["thumbnail"] is None
    Node.objects.filter(pk=node.pk).update(thumbnail_key=f"thumbs/{uuid.uuid4()}/256.webp")
    assert client.get(preview(node), query).json()["thumbnail"] is None
    assert client.get(f"/api/v1/nodes/{uuid.uuid4()}/preview", query).status_code == 404
    client.force_authenticate(User.objects.create_user("thumbnail-stranger@example.com"))
    assert client.get(preview(node), query).status_code == 404
    client.force_authenticate(user)
    user.suspended_at = timezone.now()
    user.save(update_fields=["suspended_at"])
    assert client.get(preview(node), query).status_code == 404
    user.suspended_at = None
    user.save(update_fields=["suspended_at"])
    Node.objects.filter(pk=node.pk).update(current_version=None)
    assert client.get(preview(node), query).status_code == 404
    Node.objects.filter(pk=root.pk).update(trashed_at=timezone.now(), trashed_root=root)
    assert client.get(preview(root), query).status_code == 400
    client.force_authenticate(None)
    assert client.get(preview(node), query).status_code == 403


def test_video_range_uses_direct_s3_url(client, stored_file):
    node = stored_file("video.mp4", bytes(range(256)) * 100, "video/mp4")
    result = client.get(preview(node)).json()
    request = urllib.request.Request(  # noqa: S310 - presigned LocalStack URL
        result["url"], headers={"Range": "bytes=100-199"}
    )
    with urllib.request.urlopen(request, timeout=10) as content:  # noqa: S310
        assert content.status == 206
        assert content.headers["Content-Range"] == "bytes 100-199/25600"
        assert content.read() == bytes(range(100, 200))


@pytest.mark.parametrize(
    "mime",
    [
        "text/x-markdown",
        "text/x-c",
        "text/x-c++",
        "text/x-java-source",
        "text/x-go",
        "text/x-rust",
        "text/x-shellscript",
        "application/x-sh",
        "application/x-python-code",
        "text/x-typescript",
        "application/typescript",
    ],
)
def test_code_mime_allowlist(mime):
    assert preview_kind(mime, 20) == "text"


def test_mp4_thumbnail_urls_permissions_and_stale_version(client, stored_file):
    data = (
        Path(__file__).resolve().parents[4] / "qloud_frontend/e2e/fixtures/preview.mp4"
    ).read_bytes()
    node = stored_file("clip.mp4", data, "video/mp4")
    assert generate(node.current_version_id)
    result = client.get(preview(node)).json()
    assert result["kind"] == "video"
    assert result["thumbnail"]["expires_at"] == result["expires_at"]
    for field in ["url", "large_url"]:
        with fetch(result["thumbnail"][field]) as content:
            assert content.headers["Content-Type"] == "image/webp"
            with Image.open(io.BytesIO(content.read())) as image:
                assert image.size == (160, 90)
    client.force_authenticate(User.objects.create_user("video-stranger@example.com"))
    assert client.get(preview(node)).status_code == 404
    Node.objects.filter(pk=node.pk).update(thumbnail_key=f"thumbs/{uuid.uuid4()}/256.webp")
    client.force_authenticate(node.owner)
    assert client.get(preview(node)).json()["thumbnail"] is None
