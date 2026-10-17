from unittest.mock import patch

import pytest
from django.core import mail
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.utils import translation

from apps.accounts.models import User
from apps.accounts.tasks import send_email
from apps.core.errors import ShareExists
from apps.drive.models import Node
from apps.sharing import link_services, services
from apps.sharing.models import Share

pytestmark = pytest.mark.django_db


@pytest.fixture
def sharing(api_client):
    owner = User.objects.create_user("owner@example.com", display_name="Owner")
    editor = User.objects.create_user("editor@example.com", display_name="Editor")
    recipient = User.objects.create_user("recipient@example.com")
    folder = Node.objects.create(owner=owner, parent=owner.root_folder, name="Secret <folder>")
    Share.objects.create(node=folder, grantee=editor, role="editor", created_by=owner)
    api_client.force_authenticate(owner)
    return owner, editor, recipient, folder, api_client


@pytest.mark.parametrize("locale", ["vi", "en"])
@pytest.mark.parametrize("role", ["viewer", "editor"])
@pytest.mark.parametrize("kind", ["file", "folder"])
@pytest.mark.parametrize("actor", ["owner", "editor"])
def test_email_content_recipient_locale_and_link(
    sharing, locale, role, kind, actor, settings, django_capture_on_commit_callbacks
):
    owner, editor, recipient, folder, client = sharing
    recipient.locale = locale
    recipient.save()
    user = owner if actor == "owner" else editor
    user.display_name = '<script>alert("x")</script>'
    user.save()
    node = (
        folder
        if kind == "folder"
        else Node.objects.create(owner=owner, parent=folder, kind="file", name="Report <file>")
    )
    settings.APP_BASE_URL = "https://files.example.com/"
    client.force_authenticate(user)
    with (
        translation.override("en" if locale == "vi" else "vi"),
        django_capture_on_commit_callbacks(execute=True),
    ):
        response = client.post(
            f"/api/v1/nodes/{node.pk}/shares",
            {"email": recipient.email, "role": role},
            format="json",
            HTTP_ACCEPT_LANGUAGE="en" if locale == "vi" else "vi",
        )
        assert response.status_code == 201
        assert not mail.outbox
    assert len(mail.outbox) == 1
    message = mail.outbox[0]
    assert isinstance(message, EmailMultiAlternatives)
    assert message.to == [recipient.email]
    assert message.from_email == settings.DEFAULT_FROM_EMAIL
    assert node.name in message.body
    assert user.display_name in message.body
    assert user.display_name not in message.subject
    path = "folders" if kind == "folder" else "files"
    # Shared items open under /shared, not the recipient's own Drive (M8-22).
    link = f"https://files.example.com/shared/{path}/{node.pk.hex}"
    assert link in message.body
    assert "/drive/" not in message.body
    html = message.alternatives[0][0]
    assert isinstance(html, str)
    assert link in html
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "&lt;folder&gt;" in html if kind == "folder" else "&lt;file&gt;" in html
    assert f'lang="{locale}"' in html
    if locale == "vi":
        assert message.subject == "Bạn vừa được chia sẻ một mục trên Qloud"
        assert ("Có thể chỉnh sửa" if role == "editor" else "Có thể xem") in message.body
        assert ("Thư mục" if kind == "folder" else "Tệp") in message.body
    else:
        assert message.subject == "Someone shared an item with you on Qloud"
        assert ("Can edit" if role == "editor" else "Can view") in message.body


def test_email_snapshot_is_enqueued_only_after_commit(sharing, django_capture_on_commit_callbacks):
    owner, _editor, recipient, folder, _client = sharing
    owner.display_name = ""
    owner.save()
    with (
        patch.object(send_email, "delay") as delay,
        django_capture_on_commit_callbacks(execute=False) as callbacks,
    ):
        grant = services.create_share(owner, folder.pk, recipient.email, "viewer")
        assert not delay.called
        folder.name = "Changed name"
        folder.save()
        recipient.locale, recipient.email = "en", "changed@example.com"
        recipient.save()
        services.update_share(owner, grant.pk, "editor")
        services.revoke_share(owner, grant.pk)
    assert len(callbacks) == 1
    with patch.object(send_email, "delay") as delay:
        callbacks[0]()
    delay.assert_called_once()
    body = delay.call_args.kwargs
    assert body["to"] == ["recipient@example.com"]
    assert "Secret <folder>" in body["body"]
    assert "Có thể xem" in body["body"]
    assert "owner@example.com" in body["body"]
    assert "Changed name" not in body["body"]
    assert not mail.outbox


def test_rollback_duplicate_update_revoke_and_links_do_not_send(
    sharing, django_capture_on_commit_callbacks
):
    owner, _editor, recipient, folder, _client = sharing

    def rollback() -> None:
        with transaction.atomic():
            services.create_share(owner, folder.pk, recipient.email, "viewer")
            raise ValueError("rollback")

    with (
        django_capture_on_commit_callbacks(execute=True),
        pytest.raises(ValueError, match="rollback"),
    ):
        rollback()
    assert not mail.outbox
    assert not Share.objects.filter(node=folder, grantee=recipient).exists()
    with django_capture_on_commit_callbacks(execute=True):
        grant = services.create_share(owner, folder.pk, recipient.email, "viewer")
    assert len(mail.outbox) == 1
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        with pytest.raises(ShareExists):
            services.create_share(owner, folder.pk, recipient.email, "viewer")
        services.update_share(owner, grant.pk, "editor")
        services.revoke_share(owner, grant.pk)
        link = link_services.create_link(owner, folder.pk)
        link_services.revoke_link(owner, link.pk)
    assert not callbacks
    assert len(mail.outbox) == 1
    with django_capture_on_commit_callbacks(execute=True):
        services.create_share(owner, folder.pk, recipient.email, "editor")
    assert len(mail.outbox) == 2


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"email": "absent@example.com", "role": "viewer"},
        {"email": "recipient@example.com", "role": "owner"},
    ],
)
def test_invalid_request_schedules_no_email(sharing, payload, django_capture_on_commit_callbacks):
    _owner, _editor, _recipient, folder, client = sharing
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        assert (
            client.post(f"/api/v1/nodes/{folder.pk}/shares", payload, format="json").status_code
            == 400
        )
    assert not callbacks
    assert not mail.outbox


@pytest.mark.parametrize("actor", ["viewer", "outside", None])
def test_unauthorized_request_schedules_no_email(
    sharing, actor, django_capture_on_commit_callbacks
):
    owner, _editor, recipient, folder, client = sharing
    if actor == "viewer":
        Share.objects.create(node=folder, grantee=recipient, role="viewer", created_by=owner)
    client.force_authenticate(recipient if actor else None)
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        response = client.post(
            f"/api/v1/nodes/{folder.pk}/shares",
            {"email": "absent@example.com", "role": "viewer"},
            format="json",
        )
        assert response.status_code == (404 if actor else 403)
    assert not callbacks
    assert not mail.outbox
