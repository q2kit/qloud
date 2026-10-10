from unittest.mock import patch

import pytest
from django.db.models.query import QuerySet
from django.urls import reverse

from apps.accounts.models import Plan, User
from apps.accounts.services import suspend_user

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client(client):
    admin = User.objects.create_superuser("admin@example.com", "password-123")
    client.force_login(admin)
    return client


def test_admin_lists_plans_and_users(admin_client):
    for model in ["plan", "user"]:
        assert admin_client.get(reverse(f"admin:accounts_{model}_changelist")).status_code == 200


@pytest.mark.parametrize(
    ("locale", "label"),
    [
        ("vi", "Dùng gói này cho tài khoản đăng ký mới"),
        ("en", "Use this plan for new accounts"),
    ],
)
def test_admin_action_translation(admin_client, locale, label):
    response = admin_client.get(
        reverse("admin:accounts_plan_changelist"), HTTP_ACCEPT_LANGUAGE=locale
    )
    assert label in response.content.decode()


def test_admin_cannot_deactivate_default_plan(admin_client):
    plan = Plan.objects.get(code="free-2026")
    response = admin_client.post(
        reverse("admin:accounts_plan_change", args=[plan.pk]),
        {
            "code": plan.code,
            "name": plan.name,
            "quota_bytes": str(plan.quota_bytes),
            "max_file_size_bytes": str(plan.max_file_size_bytes),
            "max_versions_per_file": "100",
            "version_retention_days": "30",
            "trash_retention_days": "30",
            "_save": "Save",
        },
    )
    assert response.status_code == 200
    plan.refresh_from_db()
    assert plan.is_active


def test_admin_default_plan_action(admin_client):
    plus = Plan.objects.get(code="plus-2026")
    response = admin_client.post(
        reverse("admin:accounts_plan_changelist"),
        {
            "action": "make_default",
            "_selected_action": [str(plus.pk)],
        },
    )
    assert response.status_code == 302
    assert Plan.objects.get(is_default_for_signup=True).pk == plus.pk


def test_admin_handles_plan_deleted_between_selection_and_action(admin_client):
    plus = Plan.objects.get(code="plus-2026")
    original = QuerySet.get

    def disappearing_plan(queryset, *args, **kwargs):
        if queryset.model is Plan:
            raise Plan.DoesNotExist
        return original(queryset, *args, **kwargs)

    with patch.object(QuerySet, "get", disappearing_plan):
        response = admin_client.post(
            reverse("admin:accounts_plan_changelist"),
            {
                "action": "make_default",
                "_selected_action": [str(plus.pk)],
            },
            follow=True,
        )
    assert response.status_code == 200
    assert "Gói đã chọn không còn tồn tại." in response.content.decode()
    assert Plan.objects.get(is_default_for_signup=True).code == "free-2026"


@pytest.mark.parametrize("selection", ["multiple", "inactive"])
def test_admin_rejects_invalid_default(admin_client, selection):
    plus = Plan.objects.get(code="plus-2026")
    if selection == "inactive":
        plus.is_active = False
        plus.save()
        ids = [str(plus.pk)]
    else:
        ids = [str(pk) for pk in Plan.objects.values_list("pk", flat=True)]
    response = admin_client.post(
        reverse("admin:accounts_plan_changelist"),
        {
            "action": "make_default",
            "_selected_action": ids,
        },
        follow=True,
    )
    assert response.status_code == 200
    assert Plan.objects.get(is_default_for_signup=True).code == "free-2026"
    if selection == "inactive":
        from django.utils.translation import gettext

        assert gettext("The default signup plan must be active.") in response.content.decode()


def test_admin_suspension_actions(admin_client):
    user = User.objects.create_user("alice@example.com")
    for action, suspended in [("suspend_accounts", True), ("unsuspend_accounts", False)]:
        response = admin_client.post(
            reverse("admin:accounts_user_changelist"),
            {
                "action": action,
                "_selected_action": [str(user.pk)],
            },
        )
        assert response.status_code == 302
        user.refresh_from_db()
        assert (user.suspended_at is not None) == suspended


def test_admin_cannot_suspend_self_and_batch_is_atomic(admin_client):
    admin = User.objects.get(email="admin@example.com")
    other = User.objects.create_user("alice@example.com")
    response = admin_client.post(
        reverse("admin:accounts_user_changelist"),
        {
            "action": "suspend_accounts",
            "_selected_action": [str(admin.pk), str(other.pk)],
        },
        follow=True,
    )
    assert response.status_code == 200
    admin.refresh_from_db()
    other.refresh_from_db()
    assert admin.suspended_at is None
    assert other.suspended_at is None
    assert "Không thể khóa tài khoản của chính bạn." in response.content.decode()


def test_staff_cannot_suspend_last_superuser(client):
    from django.contrib.auth.models import Permission

    admin = User.objects.create_superuser("admin@example.com")
    staff = User.objects.create_user("staff@example.com", is_staff=True)
    staff.user_permissions.add(Permission.objects.get(codename="change_user"))
    client.force_login(staff)
    response = client.post(
        reverse("admin:accounts_user_changelist"),
        {
            "action": "suspend_accounts",
            "_selected_action": [str(admin.pk)],
        },
        follow=True,
    )
    assert response.status_code == 200
    admin.refresh_from_db()
    assert admin.suspended_at is None
    assert "Phải còn ít nhất một superuser hoạt động." in response.content.decode()


def test_admin_can_change_user_plan_and_override(admin_client):
    user = User.objects.create_user("alice@example.com")
    plus = Plan.objects.get(code="plus-2026")
    response = admin_client.post(
        reverse("admin:accounts_user_change", args=[user.pk]),
        {
            "email": user.email,
            "display_name": "Alice",
            "locale": "en",
            "theme": "dark",
            "plan": str(plus.pk),
            "quota_override_bytes": "123",
            "is_active": "on",
            "_save": "Save",
        },
    )
    assert response.status_code == 302
    user.refresh_from_db()
    assert user.plan_id == plus.pk
    assert user.quota_override_bytes == 123


def test_admin_cannot_delete_default_or_assigned_plan(admin_client):
    user = User.objects.create_user("alice@example.com", plan=Plan.objects.get(code="plus-2026"))
    for plan in [user.plan, Plan.objects.get(code="free-2026")]:
        response = admin_client.post(
            reverse("admin:accounts_plan_delete", args=[plan.pk]), {"post": "yes"}
        )
        assert response.status_code == 403
        assert Plan.objects.filter(pk=plan.pk).exists()


@pytest.mark.parametrize("staff", [False, True])
def test_user_without_permissions_cannot_change_plans_or_suspend(client, staff):
    user = User.objects.create_user("alice@example.com", is_staff=staff)
    client.force_login(user)
    for model, action, pk in [
        ("plan", "make_default", Plan.objects.get(code="plus-2026").pk),
        ("user", "suspend_accounts", user.pk),
    ]:
        response = client.post(
            reverse(f"admin:accounts_{model}_changelist"),
            {
                "action": action,
                "_selected_action": [str(pk)],
            },
        )
        assert response.status_code == (403 if staff else 302)
    user.refresh_from_db()
    assert user.suspended_at is None
    assert Plan.objects.get(is_default_for_signup=True).code == "free-2026"


@pytest.mark.parametrize("field", ["is_active", "is_staff", "is_superuser"])
def test_change_form_cannot_remove_last_admin(admin_client, field):
    admin = User.objects.get(email="admin@example.com")
    data = {
        "email": admin.email,
        "locale": "vi",
        "theme": "system",
        "plan": str(admin.plan_id),
        "is_active": "on",
        "is_staff": "on",
        "is_superuser": "on",
        "_save": "Save",
    }
    del data[field]
    response = admin_client.post(reverse("admin:accounts_user_change", args=[admin.pk]), data)
    assert response.status_code == 200
    assert "Phải còn ít nhất một superuser hoạt động." in response.content.decode()
    admin.refresh_from_db()
    assert admin.is_active
    assert admin.is_staff
    assert admin.is_superuser


def test_change_form_can_demote_admin_when_backup_exists(admin_client):
    admin = User.objects.get(email="admin@example.com")
    User.objects.create_superuser("backup@example.com")
    response = admin_client.post(
        reverse("admin:accounts_user_change", args=[admin.pk]),
        {
            "email": admin.email,
            "locale": "vi",
            "theme": "system",
            "plan": str(admin.plan_id),
            "is_active": "on",
            "is_staff": "on",
            "_save": "Save",
        },
    )
    assert response.status_code == 302
    admin.refresh_from_db()
    assert not admin.is_superuser


def test_repeat_suspension_action_reports_kept_suspension(admin_client):
    user = User.objects.create_user("alice@example.com")
    other = User.objects.create_user("bob@example.com")
    suspend_user(user, reason="Original")
    response = admin_client.post(
        reverse("admin:accounts_user_changelist"),
        {"action": "suspend_accounts", "_selected_action": [str(user.pk), str(other.pk)]},
        follow=True,
    )
    assert "1 tài khoản đã chọn đang bị khóa từ trước" in response.content.decode()
    user.refresh_from_db()
    other.refresh_from_db()
    assert user.suspended_reason == "Original"
    assert other.suspended_at is not None


def change_form_data(user: User, **overrides: str | None) -> dict[str, str]:
    data: dict[str, str | None] = {
        "email": user.email,
        "display_name": user.display_name,
        "locale": user.locale,
        "theme": user.theme,
        "plan": str(user.plan_id),
        "_save": "Save",
    }
    for name in ("is_active", "is_staff", "is_superuser"):
        if getattr(user, name):
            data[name] = "on"
    data.update(overrides)
    return {key: value for key, value in data.items() if value is not None}


@pytest.mark.parametrize("target", ["ordinary", "admin"])
def test_change_form_skips_admin_locks_unless_a_flag_is_cleared(admin_client, target):
    user = (
        User.objects.create_user("alice@example.com")
        if target == "ordinary"
        else User.objects.get(email="admin@example.com")
    )
    with patch("apps.accounts.admin.validate_admin_access") as validate:
        response = admin_client.post(
            reverse("admin:accounts_user_change", args=[user.pk]),
            change_form_data(user, display_name="Renamed"),
        )
    assert response.status_code == 302
    validate.assert_not_called()
    user.refresh_from_db()
    assert user.display_name == "Renamed"


def test_change_form_validates_when_clearing_a_flag(admin_client):
    user = User.objects.create_user("alice@example.com", is_staff=True)
    with patch("apps.accounts.admin.validate_admin_access") as validate:
        response = admin_client.post(
            reverse("admin:accounts_user_change", args=[user.pk]),
            change_form_data(user, is_staff=None),
        )
    assert response.status_code == 302
    validate.assert_called_once()
    assert validate.call_args.kwargs == {"active": True, "staff": False, "superuser": False}
