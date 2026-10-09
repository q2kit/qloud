from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from threading import Barrier, Event
from time import monotonic, sleep
from unittest.mock import patch

import pytest
from django.core.exceptions import ValidationError
from django.db import OperationalError, connection, connections, transaction
from django.db.models.query import QuerySet

from apps.accounts.models import Plan, User
from apps.accounts.services import set_default_plan, suspend_user
from apps.drive.models import Node

pytestmark = pytest.mark.django_db(transaction=True)


def create_user_in_thread(email: str) -> User:
    try:
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '1000ms'")
            return User.objects.create_user(email)
    finally:
        connections.close_all()


def test_signups_can_provision_roots_concurrently():
    reached_root = Barrier(2, timeout=5)
    original = QuerySet.create

    def create_root(queryset, **kwargs):
        if queryset.model is Node:
            reached_root.wait()
        return original(queryset, **kwargs)

    with patch.object(QuerySet, "create", create_root), ThreadPoolExecutor(2) as pool:
        futures = [pool.submit(create_user_in_thread, f"user{i}@example.com") for i in range(2)]
        users = [future.result(timeout=10) for future in futures]
    assert all(user.root_folder_id for user in users)
    assert Node.objects.count() == 2


def test_signup_does_not_lock_unrelated_plan():
    plus = Plan.objects.get(code="plus-2026")
    with ThreadPoolExecutor(1) as pool, transaction.atomic():
        Plan.objects.select_for_update().get(pk=plus.pk)
        user = pool.submit(create_user_in_thread, "alice@example.com").result(timeout=5)
    assert user.plan.code == "free-2026"


def test_default_switch_waits_for_inflight_signup():
    entered_root, release_root = Event(), Event()
    original = QuerySet.create
    plus = Plan.objects.get(code="plus-2026")

    def create_root(queryset, **kwargs):
        if queryset.model is Node:
            entered_root.set()
            assert release_root.wait(timeout=5)
        return original(queryset, **kwargs)

    with ThreadPoolExecutor(1) as pool, patch.object(QuerySet, "create", create_root):
        future = pool.submit(create_user_in_thread, "old@example.com")
        try:
            assert entered_root.wait(timeout=5)
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute("SET LOCAL lock_timeout = '200ms'")
                with pytest.raises(OperationalError, match="lock timeout"):
                    set_default_plan(plus)
        finally:
            release_root.set()
        old = future.result(timeout=5)
    set_default_plan(plus)
    new = User.objects.create_user("new@example.com")
    assert old.plan.code == "free-2026"
    assert new.plan_id == plus.pk


def test_signup_waiting_during_default_switch_retries_with_new_plan():
    free = Plan.objects.get(code="free-2026")
    plus = Plan.objects.get(code="plus-2026")
    backend_pid = Queue[int]()

    def signup():
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                backend_pid.put(cursor.fetchone()[0])
            return create_user_in_thread("waiting@example.com")
        finally:
            connections.close_all()

    with ThreadPoolExecutor(1) as pool:
        with transaction.atomic():
            Plan.objects.select_for_update().get(pk=free.pk)
            future = pool.submit(signup)
            pid = backend_pid.get(timeout=5)
            deadline = monotonic() + 3
            while monotonic() < deadline:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s", [pid]
                    )
                    if cursor.fetchone()[0] == "Lock":
                        break
                sleep(0.01)
            else:
                pytest.fail("Signup did not reach the shared plan lock")
            set_default_plan(plus)
        user = future.result(timeout=5)
    assert user.plan_id == plus.pk


def test_simultaneous_suspensions_keep_one_superuser_available():
    admins = [User.objects.create_superuser(f"admin{i}@example.com") for i in range(2)]
    start = Barrier(2, timeout=5)

    def suspend(admin):
        try:
            start.wait()
            suspend_user(admin, reason="Review test")
            return "suspended"
        except ValidationError as error:
            return error.code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(suspend, admins))
    assert sorted(results) == ["last_superuser", "suspended"]
    assert User.objects.filter(is_superuser=True, suspended_at__isnull=True).count() == 1
