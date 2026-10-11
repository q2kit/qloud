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


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("existing", [False, True])
def test_link_migration_preserves_grants_and_reverses(existing):
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    before = [n for n in latest if n[0] != "sharing"] + [("sharing", "0001_initial")]
    executor.migrate(before)
    try:
        apps = executor.loader.project_state(before).apps
        User = apps.get_model("accounts", "User")
        Plan = apps.get_model("accounts", "Plan")
        Node = apps.get_model("drive", "Node")
        Share = apps.get_model("sharing", "Share")
        grant_id = None
        if existing:
            owner = User.objects.create(email="link-legacy@example.com", plan=Plan.objects.first())
            recipient = User.objects.create(
                email="link-recipient@example.com", plan=Plan.objects.first()
            )
            node = Node.objects.create(owner=owner, kind="folder", name="Existing node")
            grant_id = Share.objects.create(
                node=node, grantee=recipient, created_by=owner, role="editor"
            ).pk
        executor = MigrationExecutor(connection)
        executor.migrate(latest)
        apps = executor.loader.project_state(latest).apps
        assert "sharing_share_link" in connection.introspection.table_names()
        if existing:
            Link = apps.get_model("sharing", "ShareLink")
            assert apps.get_model("sharing", "Share").objects.get(pk=grant_id).role == "editor"
            Link.objects.create(node_id=node.pk, created_by_id=owner.pk)
        executor = MigrationExecutor(connection)
        executor.migrate(before)
        assert "sharing_share_link" not in connection.introspection.table_names()
        if existing:
            assert apps.get_model("sharing", "Share").objects.get(pk=grant_id).role == "editor"
        MigrationExecutor(connection).migrate(latest)
    finally:
        restore = MigrationExecutor(connection)
        restore.migrate(restore.loader.graph.leaf_nodes())
