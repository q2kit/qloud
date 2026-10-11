from datetime import timedelta
from unittest.mock import Mock

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.drive import trash
from apps.drive.models import Node, ObjectDeletion
from apps.drive.tasks import expire_trash

pytestmark = pytest.mark.django_db


def age(node: Node, days: int) -> None:
    Node.objects.filter(trashed_root=node).update(trashed_at=timezone.now() - timedelta(days=days))


def test_retention_boundaries_and_custom_plan(user, root):
    now = timezone.now()
    nodes = [Node.objects.create(owner=user, parent=root, name=str(n)) for n in range(3)]
    trash.trash(user, [n.pk for n in nodes])
    for node, delta in zip(
        nodes,
        (timedelta(days=30), timedelta(days=30, microseconds=-1), timedelta(days=31)),
        strict=True,
    ):
        Node.objects.filter(pk=node.pk).update(trashed_at=now - delta)
    assert {pk for pk, _owner in trash.expired_root_ids(now)} == {nodes[0].pk, nodes[2].pk}
    user.plan.trash_retention_days = 60
    user.plan.save(update_fields=["trash_retention_days"])
    assert trash.expired_root_ids(now) == []
    user.plan.trash_retention_days = 7
    user.plan.save(update_fields=["trash_retention_days"])
    assert len(trash.expired_root_ids(now, batch=2)) == 2


def test_daily_task_keeps_fresh_and_removes_expired_for_suspended_owner(
    user, root, make_file, monkeypatch
):
    old = make_file("old.txt")
    fresh = make_file("fresh.txt")
    User.objects.filter(pk=user.pk).update(used_bytes=6)
    trash.trash(user, [old.pk, fresh.pk])
    age(old, 31)
    User.objects.filter(pk=user.pk).update(suspended_at=timezone.now())
    enqueue = Mock()
    monkeypatch.setattr("apps.drive.tasks.enqueue_object_cleanup", enqueue)
    assert expire_trash() == 1
    assert not Node.objects.filter(pk=old.pk).exists()
    assert Node.objects.filter(pk=fresh.pk).exists()
    assert ObjectDeletion.objects.exists()
    user.refresh_from_db()
    assert user.used_bytes == 3
    enqueue.assert_called_once()
    assert expire_trash() == 0


def test_rechecks_restore_or_changed_plan_after_scan(user, root):
    node = Node.objects.create(owner=user, parent=root, name="old")
    trash.trash(user, [node.pk])
    age(node, 31)
    now = timezone.now()
    [(node_id, owner_id)] = trash.expired_root_ids(now)
    user.plan.trash_retention_days = 60
    user.plan.save(update_fields=["trash_retention_days"])
    assert trash.expire_root(node_id, owner_id, now) is False
    trash.restore(user, [node.pk])
    assert trash.expire_root(node_id, owner_id, now) is False
    assert Node.objects.filter(pk=node_id).exists()


def test_child_group_expires_without_removing_fresh_parent_group(user, root, make_file):
    parent = Node.objects.create(owner=user, parent=root, name="A")
    child = make_file(parent=parent)
    User.objects.filter(pk=user.pk).update(used_bytes=child.size)
    trash.trash(user, [child.pk])
    age(child, 31)
    trash.trash(user, [parent.pk])
    assert trash.expire_root(child.pk, user.pk, timezone.now()) is True
    assert Node.objects.filter(pk=parent.pk).exists()
    assert not Node.objects.filter(pk=child.pk).exists()
    assert trash.expire_root(child.pk, user.pk, timezone.now()) is False


def test_repeated_daily_runs_drain_multiple_batches(user, root, monkeypatch):
    nodes = [Node.objects.create(owner=user, parent=root, name=str(n)) for n in range(3)]
    trash.trash(user, [n.pk for n in nodes])
    for node in nodes:
        age(node, 31)
    scan = trash.expired_root_ids
    monkeypatch.setattr(trash, "expired_root_ids", lambda now: scan(now, batch=1))
    monkeypatch.setattr("apps.drive.tasks.enqueue_object_cleanup", Mock())
    assert expire_trash() == 3
    assert expire_trash() == 0


def test_beat_schedule(settings):
    assert settings.CELERY_BEAT_SCHEDULE["expire-trash"] == {
        "task": "apps.drive.tasks.expire_trash",
        "schedule": 86400,
    }
    assert settings.CELERY_BEAT_SCHEDULE["delete-trash-objects"] == {
        "task": "apps.drive.tasks.delete_trash_objects",
        "schedule": 3600,
    }
