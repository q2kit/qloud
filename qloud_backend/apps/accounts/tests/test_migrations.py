import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test.utils import CaptureQueriesContext


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("existing_count", [0, 1200])
def test_migration_backfill_and_reverse(existing_count):
    latest = [("accounts", "0002_user_avatar_url_user_locale_and_more")]
    old = [("accounts", "0001_initial"), ("drive", None)]
    executor = MigrationExecutor(connection)
    executor.migrate(old)
    try:
        state = executor.loader.project_state([("accounts", "0001_initial")]).apps
        LegacyUser = state.get_model("accounts", "User")
        LegacyUser.objects.bulk_create(
            [LegacyUser(email=f"legacy{i}@example.com") for i in range(existing_count)]
        )
        executor = MigrationExecutor(connection)
        with CaptureQueriesContext(connection) as queries:
            executor.migrate(latest)
        root_inserts = [
            query for query in queries if query["sql"].startswith('INSERT INTO "drive_node"')
        ]
        assert len(root_inserts) == (existing_count + 499) // 500
        apps = executor.loader.project_state(latest).apps
        Plan = apps.get_model("accounts", "Plan")
        User = apps.get_model("accounts", "User")
        free = Plan.objects.get(code="free-2026")
        plus = Plan.objects.get(code="plus-2026")
        assert free.is_default_for_signup
        assert free.is_active
        assert free.quota_bytes == free.max_file_size_bytes == 5_000_000_000
        assert plus.quota_bytes == plus.max_file_size_bytes == 50_000_000_000
        assert not plus.is_default_for_signup
        assert User.objects.count() == existing_count
        if existing_count:
            user = User.objects.get(email="legacy0@example.com")
            assert user.plan_id == free.pk
            assert user.root_folder.owner_id == user.pk
            assert user.root_folder.parent_id is None
            assert user.session_version == 0
            assert not User.objects.filter(root_folder__isnull=True).exists()
        executor = MigrationExecutor(connection)
        executor.migrate(old)
        state = executor.loader.project_state([("accounts", "0001_initial")]).apps
        assert state.get_model("accounts", "User").objects.count() == existing_count
    finally:
        MigrationExecutor(connection).migrate(latest)
