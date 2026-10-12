import datetime
import uuid

import pytest
from allauth.account.models import EmailAddress
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

from apps.accounts.models import User
from apps.uploads import services
from apps.uploads.models import UploadSession


@pytest.mark.django_db(transaction=True)
def test_version_migration_preserves_sessions_and_reverses_reservations(bucket):
    user = User.objects.create_user("migration@example.com")
    EmailAddress.objects.create(user=user, email=user.email, verified=True, primary=True)
    root = user.root_folder
    assert root is not None
    latest = [("uploads", "0002_upload_version_target")]
    previous = [("uploads", "0001_initial")]
    executor = MigrationExecutor(connection)
    executor.migrate(previous)
    try:
        old = executor.loader.project_state(previous).apps.get_model("uploads", "UploadSession")
        session = old.objects.create(
            user_id=user.pk,
            owner_id=user.pk,
            parent_id=root.pk,
            parent_path=[{"id": str(root.pk), "name": root.name}],
            filename="old.txt",
            size=0,
            mime_type="text/plain",
            fingerprint="old",
            storage_key=f"blobs/{uuid.uuid4()}",
            part_size=8388608,
            expires_at=timezone.now() + datetime.timedelta(days=7),
        )
        MigrationExecutor(connection).migrate(latest)
        assert UploadSession.objects.get(pk=session.pk).target_node_id is None
        original = services.complete(user, UploadSession.objects.get(pk=session.pk))
        replacement = services.create_session(
            user,
            parent_id=root.pk,
            filename="old.txt",
            size=5,
            mime_type="text/plain",
            fingerprint="replacement",
            target_node_id=original.pk,
        )
        MigrationExecutor(connection).migrate(previous)
        old = (
            MigrationExecutor(connection)
            .loader.project_state(previous)
            .apps.get_model("uploads", "UploadSession")
        )
        reverted = old.objects.get(pk=replacement.pk)
        assert (reverted.status, reverted.on_conflict) == ("aborted", "fail")
        user.refresh_from_db()
        assert user.reserved_bytes == 0
        assert old.objects.get(pk=session.pk).status == "completed"
    finally:
        MigrationExecutor(connection).migrate(latest)
