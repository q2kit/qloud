import uuid
from unittest.mock import patch
from urllib.parse import urlsplit
from urllib.request import urlopen

import pytest
from django.db.models import Sum
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.drive import services, trash
from apps.drive.models import Blob, FileVersion, Node, ObjectDeletion
from apps.drive.tasks import delete_trash_objects
from apps.sharing.models import Share, ShareLink
from apps.storage import s3

pytestmark = pytest.mark.django_db


@pytest.fixture
def client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def history(make_file, user):
    node = make_file()
    first = node.current_version
    blob = Blob.objects.create(storage_key=f"blobs/{uuid.uuid4()}", size=4, etag="e2")
    second = FileVersion.objects.create(
        node=node,
        blob=blob,
        version_number=2,
        size=4,
        mime_type="image/png",
        original_name="new.png",
        uploaded_by=user,
        keep_forever=True,
    )
    node.current_version, node.size, node.mime_type = second, 4, "image/png"
    node.thumbnail_key = "old-thumbnail"
    node.save()
    User.objects.filter(pk=user.pk).update(used_bytes=7)
    return node, first, second


def endpoint(node: Node, version: FileVersion | None = None, operation: str = "") -> str:
    base = f"/api/v1/nodes/{node.pk}/versions"
    return base + (f"/{version.pk}" if version else "") + (f"/{operation}" if operation else "")


def test_list_metadata_pagination_and_query_budget(client, history, django_assert_num_queries):
    node, first, second = history
    with django_assert_num_queries(2):
        response = client.get(endpoint(node), {"page_size": 1})
    assert response.status_code == 200
    item = response.data["results"][0]
    assert item == {
        "id": str(second.pk),
        "version_number": 2,
        "size": 4,
        "mime_type": "image/png",
        "original_name": "new.png",
        "uploaded_by": {"id": str(second.uploaded_by_id), "display_name": ""},
        "created_at": item["created_at"],
        "keep_forever": True,
        "is_current": True,
    }
    page = client.get(response.data["next"])
    assert page.data["results"][0]["id"] == str(first.pk)
    assert page.data["results"][0]["is_current"] is False
    assert page.data["next"] is None
    FileVersion.objects.filter(pk=first.pk).update(uploaded_by=None)
    assert client.get(endpoint(node)).data["results"][1]["uploaded_by"] is None
    assert client.get(endpoint(node), {"cursor": "invalid"}).status_code == 404


@pytest.mark.parametrize("role", ["owner", "editor", "viewer", "outsider"])
@pytest.mark.parametrize("inherited", [False, True])
def test_role_matrix(client, history, user, root, role, inherited):
    node, first, _ = history
    if role != "owner":
        actor = User.objects.create_user(f"{role}@example.com")
        if role != "outsider":
            Share.objects.create(
                node=root if inherited else node, grantee=actor, role=role, created_by=user
            )
        client.force_authenticate(actor)
    read = 404 if role == "outsider" else 200
    assert client.get(endpoint(node)).status_code == read
    with patch("apps.drive.downloads.s3.presign_download", return_value="https://example.com/file"):
        assert client.get(endpoint(node, first, "download")).status_code == read
    assert client.post(endpoint(node, first, "restore")).status_code == (
        200 if role in {"owner", "editor"} else 404
    )
    assert client.delete(endpoint(node, first)).status_code == (204 if role == "owner" else 404)


@pytest.mark.parametrize(
    ("operation", "method"), [("", "get"), ("download", "get"), ("restore", "post"), ("", "delete")]
)
def test_authentication_and_hidden_nodes(history, root, operation, method):
    node, first, _ = history
    client = APIClient()
    path = endpoint(node, None if method == "get" and not operation else first, operation)
    assert getattr(client, method)(path).status_code == 403
    client.force_authenticate(node.owner)
    folder_path = endpoint(root, None if method == "get" and not operation else first, operation)
    assert getattr(client, method)(folder_path).status_code == 400
    trash.trash(node.owner, [node.pk])
    assert getattr(client, method)(path).status_code == 404


@pytest.mark.parametrize(
    ("method", "operation"), [("get", "download"), ("post", "restore"), ("delete", "")]
)
def test_wrong_node_or_missing_version(client, history, make_file, method, operation):
    node, first, _ = history
    other = make_file("other.txt")
    assert getattr(client, method)(endpoint(other, first, operation)).status_code == 404
    first.pk = uuid.uuid4()
    assert getattr(client, method)(endpoint(node, first, operation)).status_code == 404


def test_current_version_conflict(client, history):
    node, _, current = history
    assert (
        client.post(endpoint(node, current, "restore")).data["error"]["code"] == "current_version"
    )
    assert client.delete(endpoint(node, current)).status_code == 409
    assert node.versions.count() == 2


def test_restore_preserves_identity_and_reuses_blob_at_full_quota(
    client, history, user, django_capture_on_commit_callbacks
):
    node, first, _ = history
    User.objects.filter(pk=user.pk).update(quota_override_bytes=7)
    share = ShareLink.objects.create(node=node, created_by=user)
    with (
        patch("apps.drive.services.enqueue_thumbnail") as enqueue,
        django_capture_on_commit_callbacks(execute=True),
    ):
        response = client.post(endpoint(node, first, "restore"))
    assert response.status_code == 200
    node.refresh_from_db()
    current = node.current_version
    assert current.version_number == 3
    assert current.pk != first.pk
    assert current.blob_id == first.blob_id
    assert current.original_name == first.original_name
    assert current.uploaded_by_id == user.pk
    assert current.keep_forever is False
    assert (node.name, node.size, node.mime_type, node.thumbnail_key) == (
        "a.txt",
        3,
        "text/plain",
        None,
    )
    assert node.share_links.get().pk == share.pk
    enqueue.assert_called_once_with(str(current.pk))
    user.refresh_from_db()
    assert user.used_bytes == 7
    assert Blob.objects.count() == 2


def test_delete_first_and_last_reference_and_purge(client, history, user):
    node, first, second = history
    services.restore_version(user, node.pk, first.pk)
    assert client.delete(endpoint(node, first)).status_code == 204
    user.refresh_from_db()
    assert user.used_bytes == 7
    assert not ObjectDeletion.objects.filter(storage_key=first.blob.storage_key).exists()
    assert client.delete(endpoint(node, second)).status_code == 204
    user.refresh_from_db()
    assert user.used_bytes == 3
    assert ObjectDeletion.objects.filter(storage_key=second.blob.storage_key).exists()
    assert ObjectDeletion.objects.count() == 5
    assert client.delete(endpoint(node, first)).status_code == 404
    trash.trash(user, [node.pk])
    trash.delete(user, [node.pk])
    user.refresh_from_db()
    assert user.used_bytes == 0


def test_purge_shared_versions_counts_blob_once(history, user):
    node, first, _ = history
    services.restore_version(user, node.pk, first.pk)
    services.restore_version(user, node.pk, first.pk)
    trash.trash(user, [node.pk])
    trash.delete(user, [node.pk])
    user.refresh_from_db()
    assert user.used_bytes == 0


def test_delete_is_durable_on_storage_failure(client, history):
    node, first, _ = history
    assert client.delete(endpoint(node, first)).status_code == 204
    with (
        patch("apps.drive.tasks.s3.delete_objects", side_effect=s3.StorageError("offline")),
        pytest.raises(s3.StorageError),
    ):
        delete_trash_objects.run()
    assert ObjectDeletion.objects.count() == 3
    assert Blob.objects.filter(pk=first.blob_id).exists()
    with patch("apps.drive.tasks.s3.delete_objects"):
        assert delete_trash_objects.run() == 3
    assert not ObjectDeletion.objects.exists()
    assert not Blob.objects.filter(pk=first.blob_id).exists()


def test_delete_transaction_rolls_back(client, history, user):
    node, first, _ = history
    with (
        patch.object(ObjectDeletion.objects, "bulk_create", side_effect=RuntimeError),
        pytest.raises(RuntimeError),
    ):
        client.delete(endpoint(node, first))
    assert FileVersion.objects.filter(pk=first.pk).exists()
    user.refresh_from_db()
    assert user.used_bytes == 7


def test_real_bytes_download_and_preview_after_restore(client, stored_file, user, bucket):
    node = stored_file("first.txt", b"original", "text/plain")
    first = node.current_version
    newer = stored_file("new.txt", b"replacement", "text/plain")
    second = newer.current_version
    newer.current_version = None
    newer.save()
    second.node, second.version_number = node, 2
    second.save()
    node.current_version, node.size = second, second.size
    node.name = "renamed.txt"
    node.save()
    newer.delete()
    User.objects.filter(pk=user.pk).update(used_bytes=19)
    old_link = client.get(endpoint(node, first, "download")).data["url"]
    assert "renamed.txt" in old_link
    with urlopen(old_link) as response:  # noqa: S310 - generated LocalStack HTTP URL
        assert response.read() == b"original"
    assert client.post(endpoint(node, first, "restore")).status_code == 200
    for operation in ["download", "preview"]:
        link = client.get(f"/api/v1/nodes/{node.pk}/{operation}").data["url"]
        with urlopen(link) as response:  # noqa: S310 - generated LocalStack HTTP URL
            assert response.read() == b"original"
    user.refresh_from_db()
    assert user.used_bytes == 19
    assert Blob.objects.aggregate(total=Sum("size"))["total"] == 19
    assert urlsplit(old_link).scheme == "http"


def test_old_download_uses_selected_safe_mime(client, history):
    node, first, _ = history
    first.mime_type = "image/svg+xml"
    first.save()
    with patch(
        "apps.drive.downloads.s3.presign_download", return_value="https://example.com/file"
    ) as presign:
        assert client.get(endpoint(node, first, "download")).status_code == 200
    assert presign.call_args.args == (first.blob.storage_key,)
    assert presign.call_args.kwargs["filename"] == node.name
    assert presign.call_args.kwargs["content_type"] == "application/octet-stream"


@pytest.mark.django_db(transaction=True)
def test_concurrent_upload_restore_and_delete(history, user, root, bucket):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from allauth.account.models import EmailAddress
    from django.db import connections

    from apps.uploads import services as uploads

    node, first, second = history
    third = FileVersion.objects.create(
        node=node,
        blob=Blob.objects.create(storage_key=f"blobs/{uuid.uuid4()}", size=5),
        version_number=3,
        size=5,
        mime_type="text/plain",
        original_name="third.txt",
        uploaded_by=user,
    )
    node.current_version, node.size, node.mime_type = third, 5, "text/plain"
    node.save()
    User.objects.filter(pk=user.pk).update(used_bytes=12)
    EmailAddress.objects.create(user=user, email=user.email, verified=True, primary=True)
    session = uploads.create_session(
        user,
        parent_id=root.pk,
        target_node_id=node.pk,
        filename=node.name,
        size=0,
        mime_type="text/plain",
        fingerprint="concurrent-versions",
    )
    barrier = Barrier(3)

    def run(operation: str) -> None:
        try:
            barrier.wait(timeout=10)
            if operation == "upload":
                uploads.complete(user, session)
            elif operation == "restore":
                services.restore_version(user, node.pk, first.pk)
            else:
                services.delete_version(user, node.pk, second.pk)
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=3) as executor:
        list(executor.map(run, ["upload", "restore", "delete"]))
    node.refresh_from_db()
    user.refresh_from_db()
    assert sorted(node.versions.values_list("version_number", flat=True)) == [1, 3, 4, 5]
    assert node.current_version.version_number == 5
    assert user.used_bytes == 8
    assert user.reserved_bytes == 0


def test_many_versions_do_not_add_uploader_queries(client, history, django_assert_max_num_queries):
    node, first, _ = history
    FileVersion.objects.bulk_create(
        [
            FileVersion(
                node=node,
                blob=first.blob,
                version_number=number,
                size=3,
                mime_type="text/plain",
                original_name="a.txt",
                uploaded_by=first.uploaded_by,
            )
            for number in range(3, 23)
        ]
    )
    with django_assert_max_num_queries(2):
        response = client.get(endpoint(node))
    assert len(response.data["results"]) == 22


def test_restore_rechecks_revoked_grant_after_owner_lock(history, user):
    from django.http import Http404

    from apps.drive import selectors

    node, first, _ = history
    actor = User.objects.create_user("revoked@example.com")
    grant = Share.objects.create(node=node, grantee=actor, role="editor", created_by=user)
    original = selectors.file_for

    def revoke_then_return(*args):
        selected = original(*args)
        grant.delete()
        return selected

    with (
        patch("apps.drive.selectors.file_for", side_effect=revoke_then_return),
        pytest.raises(Http404),
    ):
        services.restore_version(actor, node.pk, first.pk)
    assert node.versions.count() == 2
