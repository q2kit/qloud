import pytest
from django.urls import reverse

from apps.accounts.models import Plan, User

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
