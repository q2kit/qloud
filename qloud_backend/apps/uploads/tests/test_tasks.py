import datetime
import uuid
from typing import Any

import pytest
from django.conf import settings
from django.utils import timezone

from apps.accounts.models import User
from apps.drive.models import Node
from apps.storage import s3
from apps.uploads import services, tasks
from apps.uploads.models import UploadSession

from .conftest import put

pytestmark = pytest.mark.django_db


def session(user: User, root: Node, name: str, size: int = 10) -> UploadSession:
    return services.create_session(
        user, parent_id=root.pk, filename=name, size=size, mime_type="text/plain", fingerprint=name
    )


def age(*sessions: UploadSession, days: int = 8) -> None:
    UploadSession.objects.filter(pk__in=[s.pk for s in sessions]).update(
        expires_at=timezone.now() - datetime.timedelta(days=days - 7)
    )


def reserved(user: User) -> int:
    user.refresh_from_db(fields=["reserved_bytes"])
    return user.reserved_bytes


def open_uploads(key: str) -> list[Any]:
    listing = s3.client().list_multipart_uploads(Bucket=settings.S3_BUCKET, Prefix=key)
    return list(listing.get("Uploads", []))


def test_expired_sessions_are_closed_and_their_quota_returned(user, root):
    old = session(user, root, "old.txt", size=10)
    put(s3.presign_upload_part(old.storage_key, old.s3_upload_id, 1), b"x" * 10)
    fresh = session(user, root, "fresh.txt", size=20)
    age(old)
    assert reserved(user) == 30

    assert tasks.expire_uploads.delay().get() == 1

    old.refresh_from_db()
    fresh.refresh_from_db()
    assert (old.status, fresh.status) == ("expired", "active")
    assert reserved(user) == 20
    assert open_uploads(old.storage_key) == []
    assert open_uploads(fresh.storage_key) != []


def test_finished_and_cancelled_sessions_are_left_alone(user, root, client):
    done = session(user, root, "done.txt", size=0)
    services.complete(user, done)
    cancelled = session(user, root, "cancelled.txt")
    services.abort(user, cancelled)
    age(done, cancelled)
    assert tasks.expire_uploads.delay().get() == 0
    assert set(UploadSession.objects.values_list("status", flat=True)) == {"completed", "aborted"}
    user.refresh_from_db()
    assert (user.used_bytes, user.reserved_bytes) == (0, 0)


def test_expiry_runs_through_a_backlog_and_is_safe_to_repeat(user, root, monkeypatch):
    monkeypatch.setattr(tasks, "BATCH", 2)
    sessions = [session(user, root, f"f{i}.txt") for i in range(5)]
    age(*sessions)
    assert tasks.expire_uploads.delay().get() == 5
    assert tasks.expire_uploads.delay().get() == 0
    assert reserved(user) == 0


def test_quota_comes_back_even_when_storage_is_down(user, root, monkeypatch, caplog):
    stuck = session(user, root, "stuck.txt")
    age(stuck)

    def down(*args: Any, **kwargs: Any) -> None:
        raise s3.StorageError("unreachable")

    monkeypatch.setattr(s3, "abort_multipart_upload", down)
    assert tasks.expire_uploads.delay().get() == 1
    assert reserved(user) == 0
    assert "Could not clean up upload" in caplog.text


def test_only_active_expired_sessions_are_expired(user, root):
    upload = session(user, root, "race.txt", size=0)
    assert services.expire(upload.pk) is False  # not yet past expires_at
    age(upload)
    UploadSession.objects.filter(pk=upload.pk).update(status="completed")
    assert services.expire(upload.pk) is False  # completed meanwhile
    assert services.expire(uuid.uuid7()) is False  # gone


def test_beat_runs_expiry_hourly():
    entry = settings.CELERY_BEAT_SCHEDULE["expire-uploads"]
    assert entry == {"task": "apps.uploads.tasks.expire_uploads", "schedule": 3600}
    assert tasks.expire_uploads.name == entry["task"]
