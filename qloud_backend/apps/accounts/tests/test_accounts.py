from unittest.mock import patch

import pytest
from django.contrib.auth import authenticate, get_user
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.test import Client, RequestFactory
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
    with pytest.raises(ValidationError) as error:
        User.objects.create_user("alice@example.com")
    assert error.value.code == "no_default_plan"
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
    with pytest.raises(ValidationError) as error:
        set_default_plan(plus)
    assert error.value.code == "inactive_plan"
    with pytest.raises(ValidationError) as error:
        User.objects.create_user("alice@example.com", plan=plus)
    assert error.value.code == "inactive_plan"
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
        ("session_version", -1),
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


@pytest.mark.parametrize("engine", ["db", "cached_db", "cache"])
def test_suspend_revokes_sessions_after_unsuspension_without_scanning(
    client, settings, engine, django_assert_num_queries
):
    settings.SESSION_ENGINE = f"django.contrib.sessions.backends.{engine}"
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
    user = User.objects.create_user("alice@example.com", "password-123")
    other = User.objects.create_user("bob@example.com", "password-123")
    assert authenticate(email=user.email, password="password-123") == user
    client.force_login(user)
    old_session = client.session
    other_client = Client()
    other_client.force_login(other)
    # The query count is independent of the number of sessions in the system.
    with django_assert_num_queries(7):
        suspend_user(user, reason="Abuse")
    user.refresh_from_db()
    assert user.suspended_at is not None
    assert user.suspended_reason == "Abuse"
    assert user.session_version == 1
    assert authenticate(email=user.email, password="password-123") is None
    unsuspend_user(user)
    user.refresh_from_db()
    assert user.suspended_at is None
    assert user.suspended_reason is None
    assert authenticate(email=user.email, password="password-123") == user
    request = RequestFactory().get("/")
    request.session = old_session
    assert get_user(request).is_anonymous
    request.session = other_client.session
    assert get_user(request) == other


def test_missing_default_plan_is_translated_and_createsuperuser_handles_it():
    from django.core.management import call_command
    from django.core.management.base import CommandError
    from django.utils.translation import override

    Plan.objects.update(is_default_for_signup=False)
    with override("vi"), pytest.raises(CommandError, match="Chưa cấu hình"):
        call_command("createsuperuser", email="admin@example.com", interactive=False)


def test_deleted_default_candidate_reports_domain_error():
    plan = Plan.objects.get(code="plus-2026")
    Plan.objects.filter(pk=plan.pk).delete()
    with pytest.raises(ValidationError) as error:
        set_default_plan(plan)
    assert error.value.code == "missing_plan"


def test_stale_profile_save_cannot_undo_suspension_or_session_revocation():
    user = User.objects.create_user("alice@example.com")
    suspend_user(user, reason="Abuse")
    user.display_name = "Alice"
    user.save()
    user.refresh_from_db()
    assert user.session_version == 1
    assert user.suspended_at is not None
    assert user.suspended_reason == "Abuse"


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


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("session_version", 1),
        ("suspended_at", timezone.now()),
        ("suspended_reason", "Changed"),
        ("used_bytes", 600),
        ("reserved_bytes", 50),
        ("password", "new-hash"),
        ("is_active", False),
        ("is_staff", True),
        ("is_superuser", True),
    ],
)
def test_state_assignment_requires_explicit_fields(field, value):
    user = User.objects.create_user("alice@example.com")
    setattr(user, field, value)
    with pytest.raises(ValidationError) as error:
        user.save()
    assert error.value.code == "explicit_account_state"
    assert getattr(User.objects.get(pk=user.pk), field) != value


def test_stale_profile_preserves_quota_password_and_access_state():
    user = User.objects.create_user("alice@example.com", "old-password")
    current = User.objects.get(pk=user.pk)
    current.set_password("new-password")
    current.used_bytes = 600
    current.reserved_bytes = 50
    current.is_active = False
    current.save(update_fields=["password", "used_bytes", "reserved_bytes", "is_active"])
    user.display_name = "Alice"
    user.save()
    user.refresh_from_db()
    assert user.used_bytes == 600
    assert user.reserved_bytes == 50
    assert not user.is_active
    assert user.check_password("new-password")
    assert user.display_name == "Alice"
    user.display_name = "Alice 2"
    user.save()


def test_repeat_suspension_preserves_original_audit_and_revision():
    user = User.objects.create_user("alice@example.com")
    suspend_user(user, reason="Original")
    user.refresh_from_db()
    original = (user.suspended_at, user.suspended_reason, user.session_version)
    suspend_user(user, reason="Replacement")
    user.refresh_from_db()
    assert (user.suspended_at, user.suspended_reason, user.session_version) == original


def test_signup_with_missing_explicit_plan_reports_missing_plan():
    import uuid

    with pytest.raises(ValidationError) as error:
        User.objects.create_user("alice@example.com", plan_id=uuid.uuid7())
    assert error.value.code == "missing_plan"
    assert not User.objects.exists()


@pytest.mark.parametrize("engine", ["db", "cached_db", "cache"])
@pytest.mark.parametrize("restore", [False, True])
def test_real_login_session_is_rejected_after_suspension(client, settings, engine, restore):
    from django.urls import reverse

    settings.SESSION_ENGINE = f"django.contrib.sessions.backends.{engine}"
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
    user = User.objects.create_superuser("admin@example.com", "password-123")
    User.objects.create_superuser("backup@example.com")
    assert client.login(email=user.email, password="password-123")
    assert client.get(reverse("admin:index")).wsgi_request.user.is_authenticated
    suspend_user(user, reason="Abuse")
    if restore:
        unsuspend_user(user)
    response = client.get(reverse("admin:index"))
    assert response.status_code == 302
    assert response.wsgi_request.user.is_anonymous


def test_explicit_partial_save_does_not_hide_unsaved_state_change():
    user = User.objects.create_user("alice@example.com")
    user.session_version = 1
    user.display_name = "Alice"
    user.save(update_fields=["display_name"])
    with pytest.raises(ValidationError, match="update_fields"):
        user.save()


def test_deferred_profile_save_keeps_concurrent_state():
    user = User.objects.create_user("alice@example.com")
    profile = User.objects.only("display_name").get(pk=user.pk)
    User.objects.filter(pk=user.pk).update(used_bytes=600, is_active=False)
    profile.display_name = "Alice"
    profile.save()
    user.refresh_from_db()
    assert user.used_bytes == 600
    assert not user.is_active
    assert user.display_name == "Alice"


def test_deferred_state_assignment_cannot_be_silently_ignored():
    user = User.objects.create_user("alice@example.com")
    suspend_user(user, reason="Original")
    profile = User.objects.only("display_name").get(pk=user.pk)
    profile.suspended_at = None
    with pytest.raises(ValidationError, match="update_fields"):
        profile.save()
    assert User.objects.get(pk=user.pk).suspended_at is not None
