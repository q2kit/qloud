import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

ACCOUNTS = ("accounts", "0002_user_avatar_url_user_locale_and_more")
BEFORE = [ACCOUNTS, ("drive", "0001_initial")]
AFTER = [ACCOUNTS, ("drive", "0002_node_files_and_trash")]


@pytest.mark.django_db(transaction=True)
def test_files_and_trash_migration_keeps_existing_trees():
    executor = MigrationExecutor(connection)
    executor.migrate(BEFORE)
    try:
        apps = executor.loader.project_state(BEFORE).apps
        User = apps.get_model("accounts", "User")
        Plan = apps.get_model("accounts", "Plan")
        Node = apps.get_model("drive", "Node")
        user = User.objects.create(email="legacy@example.com", plan=Plan.objects.first())
        root = Node.objects.create(owner=user, kind="folder", name="Drive")
        Node.objects.create(owner=user, parent=root, kind="folder", name="Docs")

        executor = MigrationExecutor(connection)
        executor.migrate(AFTER)
        Node = executor.loader.project_state(AFTER).apps.get_model("drive", "Node")
        docs = Node.objects.get(name="Docs")
        assert (docs.size, docs.mime_type, docs.trashed_at, docs.current_version_id) == (
            0, None, None, None,
        )  # fmt: skip

        executor = MigrationExecutor(connection)
        executor.migrate(BEFORE)
        Node = executor.loader.project_state(BEFORE).apps.get_model("drive", "Node")
        assert Node.objects.filter(owner_id=user.pk).count() == 2
    finally:
        MigrationExecutor(connection).migrate(AFTER)
