import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("existing_user", [False, True])
def test_migration_backfill_and_reverse(existing_user):
    latest = [("accounts", "0002_user_avatar_url_user_locale_and_more")]
    old = [("accounts", "0001_initial"), ("drive", None)]
    executor = MigrationExecutor(connection)
    executor.migrate(old)
    try:
        state = executor.loader.project_state([("accounts", "0001_initial")]).apps
        if existing_user:
            state.get_model("accounts", "User").objects.create(email="legacy@example.com")
        executor = MigrationExecutor(connection)
        executor.migrate(latest)
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
        if existing_user:
            user = User.objects.get(email="legacy@example.com")
            assert user.plan_id == free.pk
            assert user.root_folder.owner_id == user.pk
            assert user.root_folder.parent_id is None
        executor = MigrationExecutor(connection)
        executor.migrate(old)
        state = executor.loader.project_state([("accounts", "0001_initial")]).apps
        assert state.get_model("accounts", "User").objects.count() == int(existing_user)
    finally:
        MigrationExecutor(connection).migrate(latest)
