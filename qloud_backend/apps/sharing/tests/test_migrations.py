import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
def test_share_migration_keeps_existing_data_and_reverses():
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    before = [node for node in latest if node[0] != "sharing"] + [("sharing", None)]
    executor.migrate(before)
    try:
        apps = executor.loader.project_state([n for n in before if n[1] is not None]).apps
        User = apps.get_model("accounts", "User")
        Plan = apps.get_model("accounts", "Plan")
        Node = apps.get_model("drive", "Node")
        owner = User.objects.create(email="legacy@example.com", plan=Plan.objects.first())
        recipient = User.objects.create(email="recipient@example.com", plan=Plan.objects.first())
        root = Node.objects.create(owner=owner, kind="folder", name="Legacy")
        executor = MigrationExecutor(connection)
        executor.migrate(latest)
        apps = executor.loader.project_state(latest).apps
        Share = apps.get_model("sharing", "Share")
        Share.objects.create(
            node_id=root.pk, grantee_id=recipient.pk, created_by_id=owner.pk, role="viewer"
        )
        assert apps.get_model("drive", "Node").objects.get(pk=root.pk).name == "Legacy"
        executor = MigrationExecutor(connection)
        executor.migrate(before)
        assert "sharing_share" not in connection.introspection.table_names()
        assert apps.get_model("drive", "Node").objects.get(pk=root.pk).name == "Legacy"
        executor = MigrationExecutor(connection)
        executor.migrate(latest)
        assert (
            not executor.loader.project_state(latest)
            .apps.get_model("sharing", "Share")
            .objects.exists()
        )
    finally:
        restore = MigrationExecutor(connection)
        restore.migrate(restore.loader.graph.leaf_nodes())
