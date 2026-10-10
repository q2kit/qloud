from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

import pytest
from django.core.exceptions import ValidationError
from django.db import connection, connections, transaction
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


def test_signup_is_not_blocked_by_default_switch_in_progress():
    plus = Plan.objects.get(code="plus-2026")
    with ThreadPoolExecutor(1) as pool:
        with transaction.atomic():
            # Hold the same locks as set_default_plan while a signup runs.
            list(Plan.objects.select_for_update(no_key=True))
            during = pool.submit(create_user_in_thread, "during@example.com").result(timeout=5)
            set_default_plan(plus)
        after = pool.submit(create_user_in_thread, "after@example.com").result(timeout=5)
    assert during.plan.code == "free-2026"
    assert after.plan_id == plus.pk


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


def test_simultaneous_admin_demotions_keep_one_available():
    from apps.accounts.services import validate_admin_access

    admins = [User.objects.create_superuser(f"admin{i}@example.com") for i in range(2)]
    start = Barrier(2, timeout=5)

    def demote(admin):
        try:
            start.wait()
            with transaction.atomic():
                validate_admin_access(admin, active=True, staff=True, superuser=False)
                admin.is_superuser = False
                admin.save(update_fields=["is_superuser"])
            return "demoted"
        except ValidationError as error:
            return error.code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(demote, admins))
    assert sorted(results) == ["demoted", "last_superuser"]
    assert User.objects.filter(is_superuser=True, is_staff=True, is_active=True).count() == 1
