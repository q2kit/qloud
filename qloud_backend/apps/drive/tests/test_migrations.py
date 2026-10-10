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
        # Every app's latest migration, including the ones after AFTER.
        restore = MigrationExecutor(connection)
        restore.migrate(restore.loader.graph.leaf_nodes())


@pytest.mark.django_db(transaction=True)
def test_recent_index_preserves_existing_files_and_is_reversible(make_file):
    file = make_file("legacy.txt", size=42)
    before = [("drive", "0004_current_version_of_own_node")]
    after = [("drive", "0005_node_node_recent_files")]
    original = (file.parent_id, file.current_version_id, file.updated_at, file.size)
    executor = MigrationExecutor(connection)
    executor.migrate(before)
    try:
        executor = MigrationExecutor(connection)
        executor.migrate(after)
        from apps.drive.models import Node

        migrated = Node.objects.get(pk=file.pk)
        assert (
            migrated.parent_id,
            migrated.current_version_id,
            migrated.updated_at,
            migrated.size,
        ) == original
        with connection.cursor() as cursor:
            constraints = connection.introspection.get_constraints(cursor, "drive_node")
        assert constraints["node_recent_files"]["index"]
        executor = MigrationExecutor(connection)
        executor.migrate(before)
        assert Node.objects.get(pk=file.pk).size == 42
        with connection.cursor() as cursor:
            assert "node_recent_files" not in connection.introspection.get_constraints(
                cursor, "drive_node"
            )
    finally:
        restore = MigrationExecutor(connection)
        restore.migrate(restore.loader.graph.leaf_nodes())
