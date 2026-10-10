import datetime
import hashlib
import os
from typing import Any

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.drive.models import Blob, FileVersion, Node
from apps.storage import s3
from apps.uploads.models import UploadSession

from .conftest import get, put

pytestmark = pytest.mark.django_db
UPLOADS = "/api/v1/uploads"
MiB = 1024 * 1024


def url(session_id: Any, action: str = "") -> str:
    return f"{UPLOADS}/{session_id}" + (f"/{action}" if action else "")


def error(response: Any) -> str:
    return str(response.json()["error"]["code"])


def start(client: Any, parent: Node, *, name: str = "a.txt", size: int = 1024, **extra: Any) -> Any:
    body = {
        "parent_id": str(parent.pk),
        "filename": name,
        "size": size,
        "mime_type": "text/plain",
        "fingerprint": "fp",
        **extra,
    }
    return client.post(UPLOADS, body, format="json")


def upload(client: Any, parent: Node, data: bytes, **extra: Any) -> dict[str, Any]:
    """The whole browser flow; returns the created node."""
    created = start(client, parent, size=len(data), **extra)
    assert created.status_code == 201, created.json()
    session = created.json()
    if data:
        numbers = list(range(1, session["part_count"] + 1))
        urls = client.post(url(session["id"], "parts"), {"part_numbers": numbers}, format="json")
        size = session["part_size"]
        for part in urls.json()["parts"]:
            n = part["part_number"]
            put(part["url"], data[(n - 1) * size : n * size])
    done = client.post(url(session["id"], "complete"))
    assert done.status_code == 200, done.json()
    return dict(done.json())


def counters(user: User) -> tuple[int, int]:
    user.refresh_from_db(fields=["used_bytes", "reserved_bytes"])
    return user.used_bytes, user.reserved_bytes


def download(node_id: Any) -> bytes:
    version = FileVersion.objects.select_related("blob").get(node_id=node_id)
    return get(
        s3.presign_download(version.blob.storage_key, filename="x", content_type="text/plain")
    )


# --- create ---------------------------------------------------------------------


def test_create_reserves_quota(client, root, user):
    response = start(client, root, size=4 * 1024 * MiB)
    assert response.status_code == 201
    body = response.json()
    assert (body["status"], body["part_size"], body["part_count"]) == ("active", 8 * MiB, 512)
    assert counters(user) == (0, 4 * 1024 * MiB)
    session = UploadSession.objects.get(pk=body["id"])
    assert session.s3_upload_id
    assert session.parent_path == [{"id": str(root.pk), "name": "Drive"}]


def test_create_checks_size_and_quota(client, root, user):
    response = start(client, root, size=5_000_000_001)
    assert (response.status_code, error(response)) == (413, "file_too_large")
    User.objects.filter(pk=user.pk).update(quota_override_bytes=1000)
    assert start(client, root, size=600).status_code == 201
    response = start(client, root, name="b.txt", size=600)
    assert (response.status_code, error(response)) == (413, "quota_exceeded")
    assert counters(user) == (0, 600)


def test_create_needs_a_verified_email(client, root, user):
    user.emailaddress_set.update(verified=False)
    response = start(client, root)
    assert (response.status_code, error(response)) == (403, "email_not_verified")


def test_create_into_a_file_or_someone_elses_folder(client, root, user, make_file):
    other = User.objects.create_user("other@example.com")
    response = start(client, Node.objects.get(owner=other, parent=None))
    assert response.status_code == 404
    response = start(client, make_file(user, root))
    assert (response.status_code, error(response)) == (400, "invalid_target")


def test_name_conflicts_fail_or_rename(client, root, user, make_file):
    make_file(user, root, "A.txt")
    response = start(client, root, name="a.txt")
    assert (response.status_code, error(response)) == (409, "name_conflict")
    node = upload(client, root, b"hi", filename="a.txt", on_conflict="rename")
    assert node["name"] == "a (1).txt"


def test_create_validates_input(client, root):
    for extra in ({"filename": "a/b"}, {"size": -1}, {"mime_type": "nope"}):
        response = start(client, root, **extra)
        assert response.status_code == 400, extra
    response = start(client, root, mime_type="")
    assert response.json()["mime_type"] == "application/octet-stream"


def test_everything_needs_sign_in(api_client, root):
    some = "01a12567-4ae6-774f-ac0d-99128521dccf"
    for response in (
        api_client.get(UPLOADS),
        api_client.post(UPLOADS, {}, format="json"),
        api_client.get(url(some)),
        api_client.delete(url(some)),
        api_client.post(url(some, "parts"), {}, format="json"),
        api_client.post(url(some, "complete")),
    ):
        assert response.status_code == 403
        assert error(response) == "not_authenticated"


# --- the whole flow ----------------------------------------------------------


@pytest.mark.parametrize("size", [0, 1024, 8 * MiB + 1234])
def test_upload_and_download(client, root, user, size):
    data = os.urandom(size)
    node = upload(client, root, data, filename="Báo cáo.bin")
    assert (node["name"], node["kind"], node["size"], node["parent_id"]) == (
        "Báo cáo.bin",
        "file",
        size,
        str(root.pk),
    )
    assert counters(user) == (size, 0)
    version = FileVersion.objects.get(node_id=node["id"])
    assert (version.version_number, version.uploaded_by_id, version.original_name) == (
        1,
        user.pk,
        "Báo cáo.bin",
    )
    assert Node.objects.get(pk=node["id"]).current_version_id == version.pk
    assert hashlib.sha256(download(node["id"])).digest() == hashlib.sha256(data).digest()


def test_status_lists_uploaded_parts(client, root):
    session = start(client, root, size=8 * MiB + 10).json()
    urls = client.post(url(session["id"], "parts"), {"part_numbers": [2]}, format="json").json()
    assert urls["expires_at"]
    put(urls["parts"][0]["url"], b"x" * 10)
    detail = client.get(url(session["id"])).json()
    assert [(p["part_number"], p["size"]) for p in detail["parts"]] == [(2, 10)]


def test_complete_with_missing_parts_keeps_the_session(client, root, user):
    session = start(client, root, size=8 * MiB + 10).json()
    urls = client.post(url(session["id"], "parts"), {"part_numbers": [1]}, format="json").json()
    put(urls["parts"][0]["url"], b"x" * 8 * MiB)
    response = client.post(url(session["id"], "complete"))
    assert (response.status_code, error(response)) == (400, "upload_incomplete")
    assert UploadSession.objects.get(pk=session["id"]).status == "active"
    assert counters(user) == (0, 8 * MiB + 10)


def test_part_numbers_must_exist(client, root):
    session = start(client, root, size=10).json()
    response = client.post(url(session["id"], "parts"), {"part_numbers": [2]}, format="json")
    assert (response.status_code, error(response)) == (400, "invalid_part")


def test_completing_twice_returns_the_same_node(client, root, user):
    session = start(client, root, size=0).json()
    first = client.post(url(session["id"], "complete")).json()
    second = client.post(url(session["id"], "complete")).json()
    assert first["id"] == second["id"]
    assert Node.objects.filter(parent=root, kind="file").count() == 1


def test_complete_after_the_database_step_failed(client, root, user, monkeypatch):
    """S3 already assembled the object; the retry must not need the parts again."""
    session = start(client, root, size=5).json()
    urls = client.post(url(session["id"], "parts"), {"part_numbers": [1]}, format="json").json()
    put(urls["parts"][0]["url"], b"hello")

    def boom(*args, **kwargs):
        raise RuntimeError("database down")

    with monkeypatch.context() as patch:
        patch.setattr(Blob.objects, "create", boom)
        with pytest.raises(RuntimeError):
            client.post(url(session["id"], "complete"))
    node = client.post(url(session["id"], "complete")).json()
    assert download(node["id"]) == b"hello"
    assert counters(user) == (5, 0)


def test_a_name_taken_meanwhile_gets_a_suffix(client, root, user, make_file):
    session = start(client, root, size=0).json()
    make_file(user, root, "a.txt")
    node = client.post(url(session["id"], "complete")).json()
    assert node["name"] == "a (1).txt"


# --- target folder gone -----------------------------------------------------------


def trash(node: Node) -> None:
    node.trashed_at, node.trashed_root = timezone.now(), node
    node.save()


def test_a_trashed_target_is_recreated_with_only_the_new_file(client, root, user, make_file):
    docs = Node.objects.create(owner=user, parent=root, name="Docs")
    make_file(user, docs, "old.txt")
    first = start(client, docs, name="one.txt", size=0).json()
    second = start(client, docs, name="two.txt", size=0).json()
    trash(docs)
    one = client.post(url(first["id"], "complete")).json()
    two = client.post(url(second["id"], "complete")).json()
    assert one["parent_id"] == two["parent_id"] != str(docs.pk)
    recreated = Node.objects.get(pk=one["parent_id"])
    assert (recreated.name, recreated.parent_id, recreated.trashed_at) == ("Docs", root.pk, None)
    assert sorted(Node.objects.filter(parent=recreated).values_list("name", flat=True)) == [
        "one.txt",
        "two.txt",
    ]


def test_a_deleted_path_is_recreated_from_the_deepest_live_folder(client, root, user):
    a = Node.objects.create(owner=user, parent=root, name="A")
    b = Node.objects.create(owner=user, parent=a, name="B")
    c = Node.objects.create(owner=user, parent=b, name="C")
    session = start(client, c, size=0).json()
    b.delete()  # takes C with it
    node = client.post(url(session["id"], "complete")).json()
    new_c = Node.objects.get(pk=node["parent_id"])
    new_b = new_c.parent
    assert new_b is not None
    assert (new_c.name, new_b.name, new_b.parent_id) == ("C", "B", a.pk)


def test_no_live_folder_left_cancels_the_upload(client, root, user, monkeypatch):
    session = start(client, root, size=10).json()
    UploadSession.objects.filter(pk=session["id"]).update(
        parent_path=[{"id": "01a12567-4ae6-774f-ac0d-99128521dccf", "name": "Gone"}]
    )
    UploadSession.objects.filter(pk=session["id"]).update(parent=None)
    monkeypatch.setattr("apps.uploads.services._assemble", lambda session: '"etag"')
    response = client.post(url(session["id"], "complete"))
    assert (response.status_code, error(response)) == (409, "target_unavailable")
    assert UploadSession.objects.get(pk=session["id"]).status == "aborted"
    assert counters(user) == (0, 0)


# --- abort, expiry, listing, access ------------------------------------------------


def test_abort_returns_quota_and_drops_parts(client, root, user, bucket):
    session = start(client, root, size=10).json()
    urls = client.post(url(session["id"], "parts"), {"part_numbers": [1]}, format="json").json()
    put(urls["parts"][0]["url"], b"x" * 10)
    assert client.delete(url(session["id"])).status_code == 204
    assert client.delete(url(session["id"])).status_code == 204
    assert counters(user) == (0, 0)
    key = UploadSession.objects.get(pk=session["id"]).storage_key
    assert not s3.client().list_multipart_uploads(Bucket=bucket, Prefix=key).get("Uploads")
    response = client.post(url(session["id"], "parts"), {"part_numbers": [1]}, format="json")
    assert (response.status_code, error(response)) == (409, "upload_closed")


def test_a_completed_upload_cannot_be_cancelled(client, root):
    session = start(client, root, size=0).json()
    client.post(url(session["id"], "complete"))
    response = client.delete(url(session["id"]))
    assert (response.status_code, error(response)) == (409, "upload_closed")


def test_expired_sessions(client, root):
    session = start(client, root, size=10).json()
    UploadSession.objects.filter(pk=session["id"]).update(
        expires_at=timezone.now() - datetime.timedelta(seconds=1)
    )
    response = client.post(url(session["id"], "parts"), {"part_numbers": [1]}, format="json")
    assert (response.status_code, error(response)) == (410, "upload_expired")
    assert error(client.post(url(session["id"], "complete"))) == "upload_expired"
    assert client.get(UPLOADS, {"status": "active"}).json()["results"] == []
    assert client.delete(url(session["id"])).status_code == 204


def test_list_active_uploads_for_resume(client, root):
    done = start(client, root, name="done.txt", size=0).json()
    client.post(url(done["id"], "complete"))
    active = start(client, root, name="active.txt", size=5).json()
    response = client.get(UPLOADS, {"status": "active"})
    assert [s["id"] for s in response.json()["results"]] == [active["id"]]
    assert len(client.get(UPLOADS).json()["results"]) == 2
    assert error(client.get(UPLOADS, {"status": "nope"})) == "validation_error"


def test_someone_elses_upload_is_404(client, root, api_client):
    session = start(client, root, size=5).json()
    api_client.force_authenticate(User.objects.create_user("other@example.com"))
    for response in (
        api_client.get(url(session["id"])),
        api_client.delete(url(session["id"])),
        api_client.post(url(session["id"], "parts"), {"part_numbers": [1]}, format="json"),
        api_client.post(url(session["id"], "complete")),
    ):
        assert response.status_code == 404
    assert api_client.get(UPLOADS).json()["results"] == []
    assert UploadSession.objects.get(pk=session["id"]).status == "active"
