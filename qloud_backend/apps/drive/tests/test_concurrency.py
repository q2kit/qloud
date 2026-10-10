import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import pytest
from django.db import connections

from apps.accounts.models import User
from apps.drive import selectors, services
from apps.drive.errors import InvalidMove
from apps.drive.models import Node

pytestmark = pytest.mark.django_db(transaction=True)


def test_crossing_moves_cannot_build_a_cycle():
    user = User.objects.create_user("owner@example.com")
    root = Node.objects.get(owner=user, parent=None)
    a = Node.objects.create(owner=user, parent=root, name="A")
    b = Node.objects.create(owner=user, parent=root, name="B")
    original = selectors.is_within

    def slow_is_within(*args, **kwargs):
        # Without the per-owner lock, both moves would pass this check before either writes.
        result = original(*args, **kwargs)
        time.sleep(0.3)
        return result

    def run(node, target):
        try:
            services.move(user, [node.pk], target.pk)
            return "moved"
        except InvalidMove:
            return "refused"
        finally:
            connections.close_all()

    with patch.object(selectors, "is_within", slow_is_within), ThreadPoolExecutor(2) as pool:
        results = sorted(
            future.result(timeout=10) for future in [pool.submit(run, a, b), pool.submit(run, b, a)]
        )
    assert results == ["moved", "refused"]
    parents = {node.name: node.parent_id for node in Node.objects.filter(pk__in=[a.pk, b.pk])}
    assert root.pk in parents.values()


@pytest.mark.parametrize("choice", ["rename", "reuse"])
def test_concurrent_folder_conflict_choices(choice):
    user = User.objects.create_user("folders@example.com")
    root = Node.objects.get(owner=user, parent=None)

    def run():
        try:
            return services.create_folder(user, root.pk, "Docs", choice).pk
        finally:
            connections.close_all()

    with ThreadPoolExecutor(2) as pool:
        futures = [pool.submit(run), pool.submit(run)]
        ids = [future.result(timeout=10) for future in futures]
    if choice == "reuse":
        assert ids[0] == ids[1]
        assert Node.objects.filter(parent=root).count() == 1
    else:
        assert ids[0] != ids[1]
        assert set(Node.objects.filter(parent=root).values_list("name", flat=True)) == {
            "Docs",
            "Docs (1)",
        }
