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
