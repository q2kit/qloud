import pytest
from django.test import Client

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.drive import services

pytestmark = pytest.mark.django_db


def test_admin_lists_and_filters_but_never_edits(user, root):
    services.create_folder(user, root.pk, "Plans")
    admin = User.objects.create_user("admin@example.com", is_staff=True, is_superuser=True)
    client = Client()
    client.force_login(admin)
    listing = client.get("/admin/audit/auditevent/?action__exact=node.create")
    assert listing.status_code == 200
    assert b"Plans" in listing.content
    event = AuditEvent.objects.get()
    assert client.get("/admin/audit/auditevent/add/").status_code == 403
    assert client.get(f"/admin/audit/auditevent/{event.pk}/change/").status_code == 200
    edit = client.post(f"/admin/audit/auditevent/{event.pk}/change/", {"node_name": "x"})
    assert edit.status_code == 403
    event.refresh_from_db()
    assert event.node_name == "Plans"
    assert (
        client.post(f"/admin/audit/auditevent/{event.pk}/delete/", {"post": "yes"}).status_code
        == 403
    )
    assert AuditEvent.objects.exists()
