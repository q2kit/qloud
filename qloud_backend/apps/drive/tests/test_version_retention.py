import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.drive import retention, services, trash
from apps.drive.models import Blob, FileVersion, ObjectDeletion
from apps.drive.tasks import expire_versions
from apps.sharing.models import Share

pytestmark = pytest.mark.django_db


@pytest.fixture
def versions(user, make_file):
    node = make_file()
    first = node.current_version
    for number in range(2, 7):
        version = FileVersion.objects.create(
            node=node,
            blob=Blob.objects.create(storage_key=f"blobs/{uuid.uuid4()}", size=3),
            version_number=number,
            size=3,
            mime_type="text/plain",
            original_name=node.name,
        )
    node.current_version = version
    node.save()
    User.objects.filter(pk=user.pk).update(used_bytes=18)
    user.plan.max_versions_per_file = 2
    user.plan.version_retention_days = None
    user.plan.save()
    return node, first


@pytest.mark.parametrize("role", ["owner", "editor", "viewer", "outsider", "anonymous"])
def test_patch_permissions_and_current(versions, user, role):
    node, _ = versions
    client = APIClient()
    if role == "owner":
        client.force_authenticate(user)
    elif role != "anonymous":
        actor = User.objects.create_user(f"{role}@example.com")
        if role != "outsider":
            Share.objects.create(node=node, grantee=actor, role=role, created_by=user)
        client.force_authenticate(actor)
    path = f"/api/v1/nodes/{node.pk}/versions/{node.current_version_id}"
    response = client.patch(path, {"keep_forever": True}, format="json")
    assert response.status_code == (200 if role == "owner" else 403 if role == "anonymous" else 404)
    if role == "owner":
        assert response.data["keep_forever"] is True
        assert response.data["is_current"] is True
        assert (
            client.patch(path, {"keep_forever": False}, format="json").data["keep_forever"] is False
        )
    assert node.versions.count() == 6


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"keep_forever": None},
        {"keep_forever": "true"},
        {"keep_forever": 1},
        {"keep_forever": []},
    ],
)
def test_patch_requires_boolean(versions, user, body):
    node, first = versions
    client = APIClient()
    client.force_authenticate(user)
    assert (
        client.patch(
            f"/api/v1/nodes/{node.pk}/versions/{first.pk}", body, format="json"
        ).status_code
        == 400
    )


def test_patch_hidden_version_folder_and_trash(versions, user, root):
    node, first = versions
    client = APIClient()
    client.force_authenticate(user)
    for node_id, version_id, expected in [(node.pk, uuid.uuid4(), 404), (root.pk, first.pk, 400)]:
        assert (
            client.patch(
                f"/api/v1/nodes/{node_id}/versions/{version_id}",
                {"keep_forever": True},
                format="json",
            ).status_code
            == expected
        )
    trash.trash(user, [node.pk])
    assert (
        client.patch(
            f"/api/v1/nodes/{node.pk}/versions/{first.pk}", {"keep_forever": True}, format="json"
        ).status_code
        == 404
    )


def test_count_keeps_pinned_outside_limit_and_current(versions, user):
    node, first = versions
    services.set_version_retention(user, node.pk, first.pk, True)
    assert retention.expire_file(node.pk, user.pk, timezone.now(), batch=1) == 1
    assert retention.expire_file(node.pk, user.pk, timezone.now()) == 1
    assert list(
        node.versions.order_by("version_number").values_list("version_number", flat=True)
    ) == [1, 4, 5, 6]
    user.refresh_from_db()
    assert user.used_bytes == 12
    assert retention.expire_file(node.pk, user.pk, timezone.now()) == 0
    services.set_version_retention(user, node.pk, first.pk, False)
    assert retention.expire_file(node.pk, user.pk, timezone.now()) == 1


def test_age_boundary_null_and_current_plan(versions, user):
    node, first = versions
    now = timezone.now()
    user.plan.max_versions_per_file = 100
    user.plan.version_retention_days = 30
    user.plan.save()
    FileVersion.objects.filter(node=node).update(created_at=now - timedelta(days=30))
    assert retention.expire_file(node.pk, user.pk, now) == 0
    # v1's age counts from when v2 replaced it.
    FileVersion.objects.filter(node=node, version_number=2).update(
        created_at=now - timedelta(days=30, microseconds=1)
    )
    services.set_version_retention(user, node.pk, first.pk, True)
    assert retention.expire_file(node.pk, user.pk, now) == 0
    services.set_version_retention(user, node.pk, first.pk, False)
    assert retention.expire_file(node.pk, user.pk, now) == 1
    user.plan.version_retention_days = None
    user.plan.max_versions_per_file = 0
    user.plan.save()
    assert retention.expire_file(node.pk, user.pk, now) == 4
    assert node.versions.get().pk == node.current_version_id


def test_age_counts_from_replacement(versions, user):
    node, first = versions
    now = timezone.now()
    user.plan.max_versions_per_file = 100
    user.plan.version_retention_days = 30
    user.plan.save()
    # A year-old v1 replaced today must survive the retention window.
    FileVersion.objects.filter(node=node).update(created_at=now)
    FileVersion.objects.filter(pk=first.pk).update(created_at=now - timedelta(days=365))
    assert retention.file_batch(now, None) == []
    assert retention.expire_file(node.pk, user.pk, now) == 0
    later = now + timedelta(days=30, seconds=1)
    assert retention.file_batch(later, None) == [(node.pk, user.pk)]
    # Every old version was replaced at `now`, so all of them expire together.
    assert retention.expire_file(node.pk, user.pk, later) == 5
    assert retention.file_batch(later, None) == []


def test_scan_selects_only_files_with_expirable_versions(
    versions, user, make_file, django_assert_num_queries
):
    node, first = versions
    now = timezone.now()
    for index in range(3):
        make_file(f"single-{index}.txt")  # one version: never needs a cleanup transaction
    pinned = make_file("pinned.txt")
    FileVersion.objects.create(
        node=pinned,
        blob=Blob.objects.create(storage_key=f"blobs/{uuid.uuid4()}", size=3),
        version_number=2,
        size=3,
        mime_type="text/plain",
        original_name=pinned.name,
    )
    FileVersion.objects.filter(node=pinned, version_number=1).update(keep_forever=True)
    pinned.current_version = pinned.versions.get(version_number=2)
    pinned.save()
    user.plan.max_versions_per_file = 0
    user.plan.save()
    with django_assert_num_queries(1):
        assert retention.file_batch(now, None) == [(node.pk, user.pk)]
    user.plan.max_versions_per_file = 4
    user.plan.save()
    assert retention.file_batch(now, None) == [(node.pk, user.pk)]
    user.plan.max_versions_per_file = 5
    user.plan.version_retention_days = 1
    user.plan.save()
    assert retention.file_batch(now, None) == []
    FileVersion.objects.filter(node=node, version_number=2).update(
        created_at=now - timedelta(days=2)
    )
    assert retention.file_batch(now, None) == [(node.pk, user.pk)]
    assert retention.file_batch(now, node.pk) == []
    with patch("apps.drive.tasks.enqueue_object_cleanup"):
        assert expire_versions() == 1
    assert retention.file_batch(now, None) == []
    assert node.versions.filter(pk=first.pk).exists() is False


def test_shared_blob_durable_cleanup_and_rollback(versions, user):
    node, first = versions
    services.restore_version(user, node.pk, first.pk)
    user.plan.max_versions_per_file = 0
    user.plan.save()
    with (
        patch.object(ObjectDeletion.objects, "bulk_create", side_effect=RuntimeError),
        pytest.raises(RuntimeError),
    ):
        retention.expire_file(node.pk, user.pk, timezone.now())
    assert node.versions.count() == 7
    user.refresh_from_db()
    assert user.used_bytes == 18
    assert retention.expire_file(node.pk, user.pk, timezone.now()) == 6
    user.refresh_from_db()
    assert user.used_bytes == 3
    assert not ObjectDeletion.objects.filter(storage_key=first.blob.storage_key).exists()
    assert ObjectDeletion.objects.count() == 17


def test_task_batches_trash_suspension_and_idempotence(versions, user, monkeypatch, settings):
    node, _ = versions
    trash.trash(user, [node.pk])
    User.objects.filter(pk=user.pk).update(suspended_at=timezone.now())
    scan = retention.file_batch
    monkeypatch.setattr(retention, "file_batch", lambda now, after: scan(now, after, batch=1))
    with patch("apps.drive.tasks.enqueue_object_cleanup"):
        assert expire_versions() == 3
        assert expire_versions() == 0
    assert retention.expire_file(uuid.uuid4(), user.pk, timezone.now()) == 0
    assert retention.expire_file(node.pk, uuid.uuid4(), timezone.now()) == 0
    assert settings.CELERY_BEAT_SCHEDULE["expire-versions"]["schedule"] == 86400


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("operation", ["pin", "restore", "delete", "upload"])
def test_cleanup_serializes_with_version_actions(versions, user, operation, root, bucket):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from django.db import connections, transaction

    node, first = versions
    user.plan.max_versions_per_file = 0
    user.plan.save()
    ready = Event()

    def sweep():
        try:
            ready.set()
            return retention.expire_file(node.pk, user.pk, timezone.now())
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=1) as executor:
        with transaction.atomic():
            User.objects.select_for_update().get(pk=user.pk)
            future = executor.submit(sweep)
            assert ready.wait(10)
            if operation == "pin":
                services.set_version_retention(user, node.pk, first.pk, True)
            elif operation == "restore":
                services.restore_version(user, node.pk, first.pk)
            elif operation == "delete":
                services.delete_version(user, node.pk, first.pk)
            else:
                from allauth.account.models import EmailAddress

                from apps.uploads import services as uploads

                EmailAddress.objects.create(
                    user=user, email=user.email, verified=True, primary=True
                )
                session = uploads.create_session(
                    user,
                    parent_id=root.pk,
                    target_node_id=node.pk,
                    filename=node.name,
                    size=0,
                    mime_type="text/plain",
                    fingerprint="retention-race",
                )
                uploads.complete(user, session)
        future.result(timeout=10)
    node.refresh_from_db()
    user.refresh_from_db()
    assert FileVersion.objects.filter(pk=node.current_version_id).exists()
    assert FileVersion.objects.filter(pk=first.pk).exists() is (operation == "pin")
    assert user.used_bytes == (6 if operation == "pin" else 0 if operation == "upload" else 3)
    assert retention.expire_file(node.pk, user.pk, timezone.now()) == 0


def test_cleanup_wins_before_pin_returns_not_found(versions, user):
    from django.http import Http404

    node, first = versions
    retention.expire_file(node.pk, user.pk, timezone.now())
    with pytest.raises(Http404):
        services.set_version_retention(user, node.pk, first.pk, True)
