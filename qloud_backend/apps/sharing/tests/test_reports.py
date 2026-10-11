import datetime
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from unittest.mock import patch

import pytest
from django.contrib import admin
from django.db import close_old_connections, transaction
from django.test import RequestFactory
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.drive.models import Node
from apps.sharing import moderation_services, report_services
from apps.sharing.models import ModerationAction, Report, ShareLink

pytestmark = pytest.mark.django_db


@pytest.fixture
def data(api_client, settings):
    settings.MODERATION_EMAIL = "moderation@example.com"
    owner = User.objects.create_user("owner-report@example.com", password="Password123!")
    moderator = User.objects.create_user("moderator@example.com", is_superuser=True, is_staff=True)
    root = Node.objects.create(owner=owner, parent=owner.root_folder, name="Public")
    child = Node.objects.create(owner=owner, parent=root, name="Child")
    outside = Node.objects.create(owner=owner, parent=owner.root_folder, name="Private")
    link = ShareLink.objects.create(node=root, created_by=owner)
    return owner, moderator, root, child, outside, link, api_client


def report_url(link: ShareLink) -> str:
    return f"/api/v1/public/links/{link.token}/reports"


def submit(data: Any, **values: Any) -> Any:
    _, _, root, _, _, link, client = data
    return client.post(
        report_url(link), {"node_id": str(root.pk), "reason": "other", **values}, format="json"
    )


def create(data: Any, ip: str = "127.0.0.1") -> Report:
    _, _, root, _, _, link, _ = data
    report = report_services.create_report(link.token, root.pk, "other", client_ip=ip)
    assert report is not None
    return report


def resolve(
    data: Any, report: Report, action: str = "revoke_link", note: str = "Verified violation"
) -> Any:
    _, moderator, _, _, _, _, client = data
    client.force_authenticate(moderator)
    return client.post(
        f"/api/v1/moderation/reports/{report.pk}/resolve",
        {"action": action, "note": note},
        format="json",
    )


def test_anonymous_report_email_hash_dedup(data, django_capture_on_commit_callbacks):
    with patch("apps.sharing.report_notifications.send_email.delay") as mail:
        with django_capture_on_commit_callbacks(execute=True):
            response = submit(data, message="<script>bad</script>", email="CONTACT@EXAMPLE.COM")
        assert response.status_code == 202
        assert response.json() == {"status": "accepted"}
        report = Report.objects.get()
        assert report.reporter_user is None
        assert report.reporter_email == "contact@example.com"
        assert len(report.reporter_ip_hash) == 64
        payload = mail.call_args.kwargs
        assert payload["to"] == ["moderation@example.com"]
        assert "/moderation?report=" in payload["body"]
        assert "<script>" not in payload["html"]
        with django_capture_on_commit_callbacks(execute=True):
            assert submit(data, node_id=str(data[3].pk), reason="illegal").status_code == 202
        assert Report.objects.count() == 1
        assert mail.call_count == 1


@pytest.mark.parametrize(
    "payload",
    [
        {"reason": "unknown"},
        {"node_id": "bad"},
        {"message": "x" * 2001},
        {"email": "bad"},
        {"email": "a" * 250 + "@example.com"},
        {"turnstile_token": "x" * 2049},
    ],
)
def test_invalid_reports_do_not_count(data, payload):
    assert submit(data, **payload).status_code == 400
    assert not Report.objects.exists()


def test_missing_required_fields(data):
    client = data[-1]
    for payload in [{}, {"node_id": str(data[2].pk)}, {"reason": "other"}]:
        assert client.post(report_url(data[5]), payload, format="json").status_code == 400


@pytest.mark.parametrize(
    "unavailable", ["outside", "revoked", "expired", "trashed", "suspended", "inactive", "invalid"]
)
def test_public_scope_is_rechecked(data, unavailable):
    owner, _, root, _, outside, link, client = data
    node_id = root.pk
    if unavailable == "outside":
        node_id = outside.pk
    elif unavailable == "revoked":
        link.revoked_at, link.revoke_reason = timezone.now(), "owner"
        link.save()
    elif unavailable == "expired":
        link.expires_at = timezone.now() - datetime.timedelta(seconds=1)
        link.save()
    elif unavailable == "trashed":
        from apps.drive.trash import trash

        trash(owner, [root.pk])
    elif unavailable == "suspended":
        owner.suspended_at = timezone.now()
        owner.save(update_fields=["suspended_at", "is_active"])
    elif unavailable == "inactive":
        owner.is_active = False
        owner.save(update_fields=["suspended_at", "is_active"])
    else:
        link.token = "invalid"
    client.force_authenticate(owner)
    assert (
        client.post(
            report_url(link), {"node_id": str(node_id), "reason": "other"}, format="json"
        ).status_code
        == 404
    )
    assert not Report.objects.exists()


def test_captcha_failure_and_reporter_session(data):
    with patch("apps.sharing.report_views.verify_turnstile", return_value=False) as verify:
        response = submit(data, turnstile_token="captcha")
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "captcha_invalid"
        verify.assert_called_once_with("captcha", "127.0.0.1")
    assert not Report.objects.exists()
    data[-1].force_authenticate(data[0])
    assert submit(data).status_code == 202
    assert Report.objects.get().reporter_user_id == data[0].pk


def test_session_requires_csrf_anonymous_does_not(data):
    owner, _, root, _, _, link, _ = data
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(owner)
    body = {"node_id": str(root.pk), "reason": "other"}
    assert client.post(report_url(link), body, format="json").status_code == 403
    client.logout()
    assert client.post(report_url(link), body, format="json").status_code == 202


def test_rate_limit_duplicate_and_rolling_windows(data):
    owner, _, root, _, _, original, client = data
    links = [ShareLink.objects.create(node=root, created_by=owner) for _ in range(6)]
    for link in links[:5]:
        assert (
            client.post(
                report_url(link), {"node_id": str(root.pk), "reason": "other"}, format="json"
            ).status_code
            == 202
        )
    response = client.post(
        report_url(links[5]), {"node_id": str(root.pk), "reason": "other"}, format="json"
    )
    assert response.status_code == 429
    assert "Retry-After" in response
    assert (
        client.post(
            report_url(links[0]), {"node_id": str(root.pk), "reason": "other"}, format="json"
        ).status_code
        == 202
    )
    assert Report.objects.count() == 5
    Report.objects.update(created_at=timezone.now() - datetime.timedelta(hours=2))
    assert submit(data).status_code == 202
    Report.objects.update(created_at=timezone.now() - datetime.timedelta(hours=25))
    assert submit(data).status_code == 202
    assert Report.objects.filter(link_uuid=original.pk).count() == 2


def test_trusted_ip_does_not_accept_spoofed_forwarded_header(data, settings):
    client = data[-1]
    body = {"node_id": str(data[2].pk), "reason": "other"}
    settings.ALLAUTH_TRUSTED_CLIENT_IP_HEADER = None
    for header in ["1.2.3.4", "5.6.7.8"]:
        assert (
            client.post(
                report_url(data[5]), body, format="json", HTTP_X_FORWARDED_FOR=header
            ).status_code
            == 202
        )
    assert Report.objects.count() == 1
    settings.ALLAUTH_TRUSTED_CLIENT_IP_HEADER = "CF-Connecting-IP"
    assert (
        client.post(
            report_url(data[5]), body, format="json", HTTP_CF_CONNECTING_IP="9.8.7.6"
        ).status_code
        == 202
    )
    assert Report.objects.count() == 2


@pytest.mark.parametrize("actor", [None, "owner", "staff", "inactive", "suspended"])
def test_moderation_permissions(data, actor):
    owner, moderator, _, _, _, _, client = data
    report = create(data)
    user = None if actor is None else owner if actor == "owner" else moderator
    if actor == "staff":
        moderator.is_superuser = False
    elif actor == "inactive":
        moderator.is_active = False
    elif actor == "suspended":
        moderator.suspended_at = timezone.now()
    moderator.save(update_fields=["is_superuser", "is_active", "suspended_at"])
    client.force_authenticate(user)
    url = f"/api/v1/moderation/reports/{report.pk}"
    assert client.get("/api/v1/moderation/reports").status_code == 403
    assert client.get(url).status_code == 403
    assert (
        client.post(
            url + "/resolve", {"action": "dismiss", "note": "Reviewed"}, format="json"
        ).status_code
        == 403
    )
    assert not ModerationAction.objects.exists()


def test_moderation_list_detail_pagination_and_no_n_plus_one(data, django_assert_num_queries):
    _, moderator, _, _, _, _, client = data
    reports = [create(data, ip=f"127.0.0.{i}") for i in range(1, 5)]
    client.force_authenticate(moderator)
    with django_assert_num_queries(1):
        page = client.get("/api/v1/moderation/reports", {"status": "open", "page_size": 2}).json()
    assert len(page["results"]) == 2
    second = client.get(page["next"]).json()
    assert len({r["id"] for r in page["results"] + second["results"]}) == 4
    detail = client.get(f"/api/v1/moderation/reports/{reports[0].pk}").json()
    assert detail["resolution"] is None
    assert "reporter_ip_hash" not in detail
    assert client.get("/api/v1/moderation/reports", {"status": "bad"}).status_code == 400
    assert client.get(f"/api/v1/moderation/reports/{uuid.uuid7()}").status_code == 404
    assert client.get(f"/api/v1/moderation/reports/{reports[0].pk}/resolve").status_code == 405


@pytest.mark.parametrize("action", ["revoke_link", "revoke_node", "suspend_owner", "dismiss"])
def test_actions_audit_and_repeat_conflict(data, action, django_capture_on_commit_callbacks):
    owner, moderator, root, child, outside, link, client = data
    another = ShareLink.objects.create(node=root, created_by=owner)
    descendant = ShareLink.objects.create(node=child, created_by=owner)
    unrelated = ShareLink.objects.create(node=outside, created_by=owner)
    report = report_services.create_report(link.token, child.pk, "malware", client_ip="1.2.3.4")
    assert report is not None
    with patch("apps.sharing.report_notifications.send_email.delay") as mail:
        with django_capture_on_commit_callbacks(execute=True):
            response = resolve(data, report, action)
        assert response.status_code == 200, response.json()
        audit = ModerationAction.objects.get()
        assert audit.actor_uuid == moderator.pk
        assert audit.note == "Verified violation"
        assert audit.report_uuid == report.pk
        assert response.json()["resolution"]["action"] == action
        for candidate in [link, another, descendant, unrelated]:
            candidate.refresh_from_db()
        assert bool(link.revoked_at) == (action in ["revoke_link", "revoke_node"])
        assert bool(another.revoked_at) == (action == "revoke_node")
        assert descendant.revoked_at is None
        assert unrelated.revoked_at is None
        assert mail.call_count == (
            2 if action == "revoke_node" else 1 if action == "revoke_link" else 0
        )
        if action == "suspend_owner":
            owner.refresh_from_db()
            assert owner.suspended_at is not None
            assert owner.session_version == 1
            for candidate in [link, another, descendant, unrelated]:
                assert client.get(f"/api/v1/public/links/{candidate.token}").status_code == 404
        assert resolve(data, report, action).status_code == 409
        assert ModerationAction.objects.count() == 1


@pytest.mark.parametrize("note", ["", "   ", "x" * 2001])
def test_notes_required_and_invalid_action(data, note):
    report = create(data)
    assert resolve(data, report, note=note).status_code == 400
    assert resolve(data, report, action="unknown").status_code == 400
    assert not ModerationAction.objects.exists()


def test_preserve_old_revocation_and_no_second_email(data, django_capture_on_commit_callbacks):
    report = create(data)
    link = data[5]
    link.revoked_at, link.revoked_by, link.revoke_reason = timezone.now(), data[0], "owner"
    link.save()
    old = (link.revoked_at, link.revoked_by_id, link.revoke_reason)
    with patch("apps.sharing.report_notifications.send_email.delay") as mail:
        with django_capture_on_commit_callbacks(execute=True):
            assert resolve(data, report).status_code == 200
        mail.assert_not_called()
    link.refresh_from_db()
    assert (link.revoked_at, link.revoked_by_id, link.revoke_reason) == old
    assert ModerationAction.objects.get().targets["revoked_link_ids"] == []


def test_self_suspension_rolls_back(data):
    _, moderator, _, _, _, _, _ = data
    report = create(data)
    report.owner_uuid = moderator.pk
    report.save()
    assert resolve(data, report, "suspend_owner").status_code == 400
    report.refresh_from_db()
    assert report.status == "open"
    assert not ModerationAction.objects.exists()


def test_audit_survives_node_and_actor_deletion(data):
    report = create(data)
    assert resolve(data, report, "dismiss").status_code == 200
    data[2].delete()
    data[1].delete()
    report.refresh_from_db()
    audit = ModerationAction.objects.get()
    assert report.node_id is None
    assert report.share_link_id is None
    assert report.node_name == "Public"
    assert audit.actor_id is None
    assert audit.actor_uuid is not None


def test_email_not_sent_on_rollback(data, django_capture_on_commit_callbacks):
    def rollback() -> None:
        with transaction.atomic():
            create(data)
            raise RuntimeError("rollback")

    with (
        patch("apps.sharing.report_notifications.send_email.delay") as mail,
        django_capture_on_commit_callbacks(execute=True),
        pytest.raises(RuntimeError),
    ):
        rollback()
    mail.assert_not_called()
    assert not Report.objects.exists()


def test_admin_readonly_and_superuser_only(data):
    factory = RequestFactory()
    for model in [Report, ModerationAction]:
        registered = admin.site._registry[model]
        for user in [data[0], data[1]]:
            request = factory.get("/admin/")
            request.user = user
            assert registered.has_view_permission(request) == user.is_superuser
            assert not registered.has_add_permission(request)
            assert not registered.has_change_permission(request)
            assert not registered.has_delete_permission(request)


def test_me_flag_cannot_be_patched(data):
    owner, moderator, _, _, _, _, client = data
    for user in [owner, moderator]:
        client.force_authenticate(user)
        assert client.get("/api/v1/me").json()["is_superuser"] == user.is_superuser
        result = client.patch("/api/v1/me", {"is_superuser": not user.is_superuser}, format="json")
        assert result.status_code == 200
        user.refresh_from_db()
        assert user.is_superuser == (user.pk == moderator.pk)


@pytest.mark.django_db(transaction=True)
def test_concurrent_duplicate_requests(data):
    token, node_id = data[5].token, data[2].pk

    def worker(_):
        close_old_connections()
        try:
            return (
                report_services.create_report(token, node_id, "other", client_ip="8.8.8.8")
                is not None
            )
        finally:
            close_old_connections()

    with (
        patch("apps.sharing.report_notifications.send_email.delay"),
        ThreadPoolExecutor(max_workers=4) as pool,
    ):
        assert sum(pool.map(worker, range(4))) == 1
    assert Report.objects.count() == 1


@pytest.mark.parametrize("locale", ["vi", "en"])
def test_revocation_email_locale_html_escape(data, locale, django_capture_on_commit_callbacks):
    owner = data[0]
    owner.locale = locale
    owner.save()
    report = create(data)
    with (
        patch("apps.sharing.report_notifications.send_email.delay") as mail,
        django_capture_on_commit_callbacks(execute=True),
    ):
        assert resolve(data, report, note='<script>alert("x")</script>').status_code == 200
    payload = mail.call_args.kwargs
    assert payload["subject"] == (
        "Một link công khai đã bị gỡ trên Qloud"
        if locale == "vi"
        else "A public link was removed on Qloud"
    )
    assert payload["to"] == [owner.email]
    assert "<script>" not in payload["html"]
    assert "&lt;script&gt;" in payload["html"]


def test_missing_owner_suspend_returns_conflict(data):
    report = create(data)
    report.owner_uuid = uuid.uuid7()
    report.save()
    assert resolve(data, report, "suspend_owner").status_code == 409
    report.refresh_from_db()
    assert report.status == "open"
    assert not ModerationAction.objects.exists()


def test_blank_moderation_mailbox_in_dev_does_not_break_reporting(
    data, settings, django_capture_on_commit_callbacks
):
    settings.MODERATION_EMAIL = ""
    with (
        patch("apps.sharing.report_notifications.send_email.delay") as mail,
        django_capture_on_commit_callbacks(execute=True),
    ):
        assert submit(data).status_code == 202
    mail.assert_not_called()


@pytest.mark.django_db(transaction=True)
def test_concurrent_reports_share_one_ip_quota(data):
    from rest_framework.exceptions import Throttled

    links = [ShareLink.objects.create(node=data[2], created_by=data[0]).token for _ in range(8)]
    node_id = data[2].pk

    def worker(token):
        close_old_connections()
        try:
            report_services.create_report(token, node_id, "other", client_ip="7.7.7.7")
            return True
        except Throttled:
            return False
        finally:
            close_old_connections()

    with (
        patch("apps.sharing.report_notifications.send_email.delay"),
        ThreadPoolExecutor(max_workers=8) as pool,
    ):
        assert sum(pool.map(worker, links)) == 5
    assert Report.objects.count() == 5


@pytest.mark.django_db(transaction=True)
def test_concurrent_resolutions_commit_one_audit(data):
    from apps.core.errors import ReportResolved

    report = create(data)
    moderator_id = data[1].pk

    def worker(_):
        close_old_connections()
        try:
            actor = User.objects.get(pk=moderator_id)
            moderation_services.resolve_report(actor, report.pk, "revoke_link", "Reviewed")
            return True
        except ReportResolved:
            return False
        finally:
            close_old_connections()

    with (
        patch("apps.sharing.report_notifications.send_email.delay"),
        ThreadPoolExecutor(max_workers=4) as pool,
    ):
        assert sum(pool.map(worker, range(4))) == 1
    assert ModerationAction.objects.count() == 1
