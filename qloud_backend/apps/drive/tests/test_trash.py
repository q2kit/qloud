import time
import uuid
from unittest.mock import Mock

import pytest
from django.db import transaction
from kombu.exceptions import KombuError
from rest_framework.response import Response
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.drive import trash
from apps.drive.models import Blob, FileVersion, Node, ObjectDeletion
from apps.drive.tasks import delete_trash_objects, enqueue_object_cleanup
from apps.storage import s3

pytestmark = pytest.mark.django_db


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user)
    return api_client


def post(client: APIClient, path: str, *nodes: Node) -> Response:
    return client.post(f"/api/v1/{path}", {"node_ids": [str(n.pk) for n in nodes]}, format="json")


def folder(user: User, parent: Node, name: str) -> Node:
    return Node.objects.create(owner=user, parent=parent, name=name)


def test_nested_groups_and_restore(client, user, root, make_file):
    parent = folder(user, root, "A")
    child = make_file("X", parent=parent)
    sibling = make_file("Y", parent=parent)
    assert post(client, "nodes/trash", child).status_code == 200
    child.refresh_from_db()
    old_time = child.trashed_at
    assert post(client, "nodes/trash", parent).status_code == 200
    child.refresh_from_db()
    sibling.refresh_from_db()
    assert child.trashed_root_id == child.pk
    assert child.trashed_at == old_time
    assert sibling.trashed_root_id == parent.pk
    listing = client.get("/api/v1/trash").json()["results"]
    assert {n["id"] for n in listing} == {str(child.pk), str(parent.pk)}
    assert client.get(f"/api/v1/nodes/{sibling.pk}").status_code == 404
    assert post(client, "trash/restore", parent).status_code == 200
    child.refresh_from_db()
    sibling.refresh_from_db()
    assert child.trashed_at is not None
    assert sibling.trashed_at is None


def test_overlapping_selection_returns_only_outer_root(client, user, root, make_file):
    parent = folder(user, root, "A")
    child = make_file(parent=parent)
    result = post(client, "nodes/trash", child, parent).data["nodes"]
    assert [n["id"] for n in result] == [str(parent.pk)]
    child.refresh_from_db()
    assert child.trashed_root_id == parent.pk


def test_restore_parent_missing_or_trashed_and_conflict(client, user, root, make_file):
    parent = folder(user, root, "A")
    child = make_file("report.txt", parent=parent)
    trash.trash(user, [child.pk, parent.pk])
    # A child selected together with A belongs to A, not a separate group.
    assert post(client, "trash/restore", child).status_code == 404
    trash.restore(user, [parent.pk])
    trash.trash(user, [child.pk])
    trash.trash(user, [parent.pk])
    make_file("report.txt")
    assert post(client, "trash/restore", child).status_code == 200
    child.refresh_from_db()
    assert child.parent_id == root.pk
    assert child.name == "report (1).txt"


def test_restore_parent_and_child_in_any_order(user, root, make_file):
    parent = folder(user, root, "A")
    child = make_file(parent=parent)
    trash.trash(user, [child.pk])
    trash.trash(user, [parent.pk])
    trash.restore(user, [child.pk, parent.pk])
    child.refresh_from_db()
    assert child.parent_id == parent.pk
    assert child.trashed_at is None


def test_restore_siblings_name_conflict(user, root, make_file):
    first = make_file("a.txt")
    trash.trash(user, [first.pk])
    second = make_file("a.txt")
    trash.trash(user, [second.pk])
    trash.restore(user, [first.pk, second.pk])
    assert set(
        Node.objects.filter(pk__in=[first.pk, second.pk]).values_list("name", flat=True)
    ) == {"a.txt", "a (1).txt"}


@pytest.mark.parametrize("path", ["nodes/trash", "trash/restore", "trash/delete"])
def test_input_and_permissions(client, api_client, user, root, make_file, path):
    node = make_file()
    if path != "nodes/trash":
        trash.trash(user, [node.pk])
    assert client.post(f"/api/v1/{path}", {"node_ids": []}, format="json").status_code == 400
    assert client.post(f"/api/v1/{path}", {"node_ids": ["bad"]}, format="json").status_code == 400
    assert (
        client.post(f"/api/v1/{path}", {"node_ids": [str(uuid.uuid7())]}, format="json").status_code
        == 404
    )
    assert post(client, path, root).status_code in (400, 404)
    stranger = User.objects.create_user(f"{path.replace('/', '-')}@example.com")
    api_client.force_authenticate(stranger)
    assert post(api_client, path, node).status_code == 404
    api_client.force_authenticate(None)
    assert post(api_client, path, node).status_code == 403


def test_list_empty_isolation_and_auth(client, api_client, user, make_file):
    node = make_file()
    trash.trash(user, [node.pk])
    stranger = User.objects.create_user("stranger@example.com")
    api_client.force_authenticate(stranger)
    assert api_client.get("/api/v1/trash").json()["results"] == []
    assert api_client.post("/api/v1/trash/empty").status_code == 204
    assert Node.objects.filter(pk=node.pk).exists()
    api_client.force_authenticate(None)
    assert api_client.get("/api/v1/trash").status_code == 403
    assert api_client.post("/api/v1/trash/empty").status_code == 403


def test_list_cursor_and_queries(client, user, root, django_assert_max_num_queries):
    nodes = [folder(user, root, f"node-{n}") for n in range(12)]
    trash.trash(user, [n.pk for n in nodes])
    with django_assert_max_num_queries(1):
        response = client.get("/api/v1/trash?page_size=5").json()
    seen = response["results"]
    while response["next"]:
        response = client.get(response["next"]).json()
        seen += response["results"]
    assert len(seen) == len({n["id"] for n in seen}) == 12
    assert client.get("/api/v1/trash?cursor=bad").status_code == 404
    assert client.get("/api/v1/trash?page_size=0").status_code == 400


def test_batch_atomic_and_duplicate_ids(client, user, make_file):
    node = make_file()
    invalid = client.post(
        "/api/v1/nodes/trash", {"node_ids": [str(node.pk), str(uuid.uuid7())]}, format="json"
    )
    assert invalid.status_code == 404
    node.refresh_from_db()
    assert node.trashed_at is None
    assert post(client, "nodes/trash", node, node).status_code == 200
    assert post(client, "trash/restore", node, node).status_code == 200


def test_thousand_descendants_single_request(client, user, root, django_assert_max_num_queries):
    parent = folder(user, root, "Large")
    Node.objects.bulk_create([Node(owner=user, parent=parent, name=f"n-{n}") for n in range(1000)])
    started = time.monotonic()
    with django_assert_max_num_queries(6):
        response = post(client, "nodes/trash", parent)
    assert response.status_code == 200
    assert time.monotonic() - started < 1
    assert Node.objects.filter(trashed_root=parent).count() == 1001


def test_delete_versions_quota_and_durable_objects(
    client, user, make_file, django_capture_on_commit_callbacks, monkeypatch
):
    node = make_file(size=3)
    blob = Blob.objects.create(storage_key="blobs/second", size=4)
    FileVersion.objects.create(
        node=node,
        blob=blob,
        version_number=2,
        size=4,
        mime_type="text/plain",
        original_name="a.txt",
    )
    User.objects.filter(pk=user.pk).update(used_bytes=7)
    trash.trash(user, [node.pk])
    callback = Mock()
    monkeypatch.setattr("apps.drive.tasks.enqueue_object_cleanup", callback)
    with django_capture_on_commit_callbacks(execute=True):
        assert post(client, "trash/delete", node).status_code == 204
        callback.assert_not_called()
        assert not Node.objects.filter(pk=node.pk).exists()
    callback.assert_called_once()
    user.refresh_from_db()
    assert user.used_bytes == 0
    assert Blob.objects.count() == 2
    assert ObjectDeletion.objects.count() == 6
    mocked = Mock()
    monkeypatch.setattr(s3, "delete_objects", mocked)
    assert delete_trash_objects() == 6
    assert not Blob.objects.exists()
    assert not ObjectDeletion.objects.exists()
    assert delete_trash_objects() == 0


def test_delete_parent_includes_older_group(user, root, make_file):
    parent = folder(user, root, "A")
    child = make_file(parent=parent)
    User.objects.filter(pk=user.pk).update(used_bytes=child.size)
    trash.trash(user, [child.pk])
    trash.trash(user, [parent.pk])
    trash.delete(user, [parent.pk])
    assert not Node.objects.filter(pk__in=[parent.pk, child.pk]).exists()
    user.refresh_from_db()
    assert user.used_bytes == 0


def test_delete_shared_blob_keeps_object(user, make_file, monkeypatch):
    first = make_file("first.txt")
    second = make_file("second.txt")
    shared = first.current_version.blob
    FileVersion.objects.filter(pk=second.current_version_id).update(blob=shared)
    User.objects.filter(pk=user.pk).update(used_bytes=3)
    trash.trash(user, [first.pk])
    trash.delete(user, [first.pk])
    delete_objects = Mock()
    monkeypatch.setattr(s3, "delete_objects", delete_objects)
    delete_trash_objects()
    assert Blob.objects.filter(pk=shared.pk).exists()
    assert shared.storage_key not in list(delete_objects.call_args.args[0])

    user.refresh_from_db()
    assert user.used_bytes == 3


def test_cleanup_failure_keeps_intent_and_blob(user, make_file, monkeypatch):
    node = make_file()
    User.objects.filter(pk=user.pk).update(used_bytes=node.size)
    trash.trash(user, [node.pk])
    trash.delete(user, [node.pk])
    monkeypatch.setattr(s3, "delete_objects", Mock(side_effect=s3.StorageError("offline")))
    with pytest.raises(s3.StorageError), transaction.atomic():
        delete_trash_objects.run()
    assert ObjectDeletion.objects.exists()
    assert Blob.objects.exists()


def test_broker_failure_is_logged(monkeypatch, caplog):
    monkeypatch.setattr(
        "apps.drive.tasks.delete_trash_objects.delay", Mock(side_effect=KombuError("offline"))
    )
    enqueue_object_cleanup()
    assert "Could not enqueue trash object cleanup" in caplog.text


def test_empty_and_live_node_rejection(client, user, root):
    first = folder(user, root, "one")
    second = folder(user, root, "two")
    assert post(client, "trash/delete", first).status_code == 404
    trash.trash(user, [first.pk, second.pk])
    assert client.post("/api/v1/trash/empty").status_code == 204
    assert not trash.roots_for(user).exists()
    assert Node.objects.filter(pk=root.pk).exists()


def test_real_s3_delete_and_thumbnail_cleanup(
    user, stored_file, django_capture_on_commit_callbacks
):
    node = stored_file("gone.txt", b"abc", "text/plain")
    key = node.current_version.blob.storage_key
    thumb = f"thumbs/{node.current_version_id}/256.webp"
    s3.put_object(thumb, b"thumb", "image/webp")
    User.objects.filter(pk=user.pk).update(used_bytes=3)
    trash.trash(user, [node.pk])
    with django_capture_on_commit_callbacks(execute=True):
        trash.delete(user, [node.pk])
    for object_key in (key, thumb):
        with pytest.raises(s3.StorageError):
            s3.head_object(object_key)
    assert not ObjectDeletion.objects.exists()


def test_rollback_keeps_nodes_quota_and_no_cleanup(
    user, make_file, django_capture_on_commit_callbacks
):
    node = make_file()
    User.objects.filter(pk=user.pk).update(used_bytes=node.size)
    trash.trash(user, [node.pk])
    with django_capture_on_commit_callbacks() as callbacks, transaction.atomic():
        trash.delete(user, [node.pk])
        transaction.set_rollback(True)
    assert callbacks == []
    assert Node.objects.filter(pk=node.pk).exists()
    assert not ObjectDeletion.objects.exists()
    user.refresh_from_db()
    assert user.used_bytes == node.size


@pytest.mark.parametrize("operation", ["create", "move"])
def test_tree_writes_recheck_target_after_owner_lock(user, root, make_file, monkeypatch, operation):
    from django.http import Http404

    from apps.drive import services

    target = folder(user, root, "Target")
    source = make_file()
    lookup = services._target_folder
    calls = 0

    def racing_lookup(*args):
        nonlocal calls
        result = lookup(*args)
        calls += 1
        if calls == 1:
            trash.trash(user, [target.pk])
        return result

    monkeypatch.setattr(services, "_target_folder", racing_lookup)

    def run() -> None:
        if operation == "create":
            services.create_folder(user, target.pk, "New")
        else:
            services.move(user, [source.pk], target.pk)

    with pytest.raises(Http404):
        run()
    assert not Node.objects.filter(parent=target, trashed_at__isnull=True).exists()
