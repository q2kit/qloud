from unittest.mock import patch

import pytest
from django.contrib.auth import SESSION_KEY, authenticate, get_user
from django.contrib.sessions.models import Session
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.test import RequestFactory
from django.utils import timezone

from apps.accounts.models import Plan, User
from apps.accounts.selectors import get_limits
from apps.accounts.services import set_default_plan, suspend_user, unsuspend_user
from apps.drive.models import Node

pytestmark = pytest.mark.django_db


def test_signup_provisions_root_and_preferences():
    user = User.objects.create_user("alice@example.com", locale="en", theme="dark")
    assert user.plan.code == "free-2026"
    assert user.used_bytes == user.reserved_bytes == 0
    assert user.locale == "en"
    assert user.theme == "dark"
    assert user.root_folder is not None
    assert user.root_folder.owner == user
    assert user.root_folder.kind == "folder"
    assert user.root_folder.parent is None
    assert str(user.root_folder) == "Drive"
    assert user.root_folder.id.version == 7
    root_id = user.root_folder_id
    user.display_name = "Alice"
    user.save()
    assert user.root_folder_id == root_id
    assert Node.objects.filter(owner=user).count() == 1


def test_direct_save_provisions_user_with_unusable_password():
    user = User(email="OAUTH@EXAMPLE.COM")
    user.save()
    assert user.email == "oauth@example.com"
    assert not user.has_usable_password()
    assert user.root_folder is not None


def test_provisioning_rolls_back_when_root_creation_fails():
    with patch("apps.accounts.services.Node.objects") as nodes:
        nodes.using.return_value.create.side_effect = RuntimeError("root failed")
        with pytest.raises(RuntimeError, match="root failed"):
            User.objects.create_user("alice@example.com")
    assert not User.objects.exists()
    assert not Node.objects.exists()


def test_signup_without_default_fails_without_partial_user():
    Plan.objects.update(is_default_for_signup=False)
    with pytest.raises(ValidationError, match="No default"):
        User.objects.create_user("alice@example.com")
    assert not User.objects.exists()


def test_switch_default_preserves_existing_users_and_limits(django_assert_num_queries):
    old = User.objects.create_user("old@example.com")
    plus = Plan.objects.get(code="plus-2026")
    set_default_plan(plus)
    new = User.objects.create_user("new@example.com")
    assert new.plan_id == plus.pk
    old.refresh_from_db()
    assert old.plan.code == "free-2026"
    with django_assert_num_queries(1):
        limits = get_limits(old)
    assert limits.quota_bytes == limits.max_file_size_bytes == 5_000_000_000
    assert limits.max_versions_per_file == 100
    assert limits.version_retention_days == limits.trash_retention_days == 30
    assert get_limits(new).quota_bytes == 50_000_000_000


def test_limits_reflect_override_and_plan_changes_immediately():
    user = User.objects.create_user("alice@example.com")
    User.objects.filter(pk=user.pk).update(quota_override_bytes=0)
    assert get_limits(user).quota_bytes == 0
    User.objects.filter(pk=user.pk).update(quota_override_bytes=123)
    assert get_limits(user).quota_bytes == 123
    User.objects.filter(pk=user.pk).update(quota_override_bytes=None)
    Plan.objects.filter(pk=user.plan_id).update(quota_bytes=999, version_retention_days=None)
    assert get_limits(user).quota_bytes == 999
    assert get_limits(user).version_retention_days is None


def test_inactive_plan_cannot_be_assigned_or_become_default():
    plus = Plan.objects.get(code="plus-2026")
    plus.is_active = False
    plus.save()
    with pytest.raises(ValidationError, match="must be active"):
        set_default_plan(plus)
    with pytest.raises(ValidationError, match="inactive"):
        User.objects.create_user("alice@example.com", plan=plus)
    assert Plan.objects.get(is_default_for_signup=True).code == "free-2026"


def test_explicit_plan_and_inactive_existing_plan():
    plus = Plan.objects.get(code="plus-2026")
    user = User.objects.create_user("alice@example.com", plan=plus)
    plus.is_active = False
    plus.save()
    assert get_limits(user).quota_bytes == 50_000_000_000
    with pytest.raises(ProtectedError):
        plus.delete()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("quota_override_bytes", -1),
        ("used_bytes", -1),
        ("reserved_bytes", -1),
        ("locale", "fr"),
        ("theme", "invalid"),
    ],
)
def test_user_constraints(field, value):
    user = User.objects.create_user("alice@example.com")
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.filter(pk=user.pk).update(**{field: value})


def test_default_plan_constraints():
    plus = Plan.objects.get(code="plus-2026")
    with pytest.raises(IntegrityError), transaction.atomic():
        Plan.objects.filter(pk=plus.pk).update(is_default_for_signup=True)
    with pytest.raises(IntegrityError), transaction.atomic():
        Plan.objects.filter(is_default_for_signup=True).update(is_active=False)


@pytest.mark.parametrize("fields", [{"name": ""}, {"name": "a/b"}, {"kind": "file"}])
def test_root_constraints(fields):
    user = User.objects.create_user("alice@example.com")
    assert user.root_folder_id is not None
    with pytest.raises(IntegrityError), transaction.atomic():
        Node.objects.filter(pk=user.root_folder_id).update(**fields)
    with pytest.raises(IntegrityError), transaction.atomic():
        Node.objects.create(owner=user, name="Another root")


def test_suspend_removes_only_target_sessions_and_blocks_authentication(client):
    user = User.objects.create_user("alice@example.com", "password-123")
    other = User.objects.create_user("bob@example.com", "password-123")
    assert authenticate(email=user.email, password="password-123") == user
    client.force_login(user)
    key = client.session.session_key
    other_session = client.session.__class__()
    other_session[SESSION_KEY] = str(other.pk)
    other_session.save()
    suspend_user(user, reason="Abuse")
    user.refresh_from_db()
    assert user.suspended_at is not None
    assert user.suspended_reason == "Abuse"
    assert not Session.objects.filter(session_key=key).exists()
    assert Session.objects.filter(session_key=other_session.session_key).exists()
    assert authenticate(email=user.email, password="password-123") is None
    request = RequestFactory().get("/")
    request.session = other_session
    assert get_user(request).is_anonymous
    unsuspend_user(user)
    user.refresh_from_db()
    assert user.suspended_at is None
    assert user.suspended_reason is None
    assert authenticate(email=user.email, password="password-123") == user
    assert not Session.objects.filter(session_key=key).exists()


def test_suspended_backend_rejects_existing_session(client):
    user = User.objects.create_user("alice@example.com")
    client.force_login(user)
    User.objects.filter(pk=user.pk).update(suspended_at=timezone.now())
    request = RequestFactory().get("/")
    request.session = client.session
    assert get_user(request).is_anonymous


def test_inactive_user_cannot_authenticate():
    user = User.objects.create_user("alice@example.com", "password-123", is_active=False)
    assert authenticate(email=user.email, password="password-123") is None


def test_validation_rejects_switch_to_inactive_plan_but_keeps_existing_assignment():
    user = User.objects.create_user("alice@example.com")
    plus = Plan.objects.get(code="plus-2026")
    plus.is_active = False
    plus.save()
    user.plan = plus
    with pytest.raises(ValidationError) as error:
        user.clean()
    assert "plan" in error.value.message_dict
    User.objects.filter(pk=user.pk).update(plan=plus)
    user.clean()
