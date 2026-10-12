import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

ACCOUNTS = ("accounts", "0002_user_avatar_url_user_locale_and_more")
BEFORE = [ACCOUNTS, ("drive", "0006_objectdeletion")]
AFTER = [ACCOUNTS, ("drive", "0007_node_search_name_node_node_search_trgm")]


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("populated", [False, True])
def test_search_migration_backfills_and_reverses(populated):
    executor = MigrationExecutor(connection)
    executor.migrate(BEFORE)
    try:
        if populated:
            apps = executor.loader.project_state(BEFORE).apps
            User = apps.get_model("accounts", "User")
            Plan = apps.get_model("accounts", "Plan")
            Node = apps.get_model("drive", "Node")
            user = User.objects.create(email="legacy-search@example.com", plan=Plan.objects.first())
            root = Node.objects.create(owner=user, kind="folder", name="Drive")
            report = Node.objects.create(owner=user, parent=root, name="Đường Báo cáo")
        executor = MigrationExecutor(connection)
        executor.migrate(AFTER)
        Node = executor.loader.project_state(AFTER).apps.get_model("drive", "Node")
        if populated:
            row = Node.objects.get(pk=report.pk)
            assert (row.name, row.search_name, row.parent_id) == (
                "Đường Báo cáo",
                "duong bao cao",
                root.pk,
            )
            Node.objects.filter(pk=row.pk).update(name="Đổi tên")
            assert Node.objects.get(pk=row.pk).search_name == "doi ten"
        with connection.cursor() as cursor:
            assert connection.introspection.get_constraints(cursor, "drive_node")[
                "node_search_trgm"
            ]["index"]
        executor = MigrationExecutor(connection)
        executor.migrate(BEFORE)
        Node = executor.loader.project_state(BEFORE).apps.get_model("drive", "Node")
        if populated:
            assert Node.objects.get(pk=report.pk).name == "Đổi tên"
        with connection.cursor() as cursor:
            assert "node_search_trgm" not in connection.introspection.get_constraints(
                cursor, "drive_node"
            )
    finally:
        restore = MigrationExecutor(connection)
        restore.migrate(restore.loader.graph.leaf_nodes())
