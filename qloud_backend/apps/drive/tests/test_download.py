import datetime
import urllib.request
from typing import Any

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.drive.downloads import safe_content_type
from apps.drive.models import Node

pytestmark = pytest.mark.django_db


def download(node_id: Any) -> str:
    return f"/api/v1/nodes/{node_id}/download"


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user)
    return api_client


def fetch(url: str) -> Any:
    return urllib.request.urlopen(url, timeout=10)  # noqa: S310 - presigned LocalStack URL


def test_download_keeps_the_vietnamese_name(client, stored_file, django_assert_num_queries):
    node = stored_file("Báo cáo quý 3.pdf", b"%PDF-1.7 hello", "application/pdf")
    with django_assert_num_queries(2):  # the node, then its version with the blob
        response = client.get(download(node.pk))
    assert response.status_code == 200
    body = response.json()
    expires_at = datetime.datetime.fromisoformat(body["expires_at"])
    assert timezone.now() + datetime.timedelta(minutes=4) < expires_at
    assert expires_at <= timezone.now() + datetime.timedelta(minutes=5)

    with fetch(body["url"]) as file:
        assert file.read() == b"%PDF-1.7 hello"
        assert file.headers["Content-Type"] == "application/pdf"
        disposition = file.headers["Content-Disposition"]
    assert disposition.startswith("attachment;")
    assert "filename*=UTF-8''B%C3%A1o%20c%C3%A1o%20qu%C3%BD%203.pdf" in disposition


def test_download_uses_the_current_name(client, stored_file):
    node = stored_file("old.txt", b"x", "text/plain")
    Node.objects.filter(pk=node.pk).update(name="new.txt")
    with fetch(client.get(download(node.pk)).json()["url"]) as file:
        assert 'filename="new.txt"' in file.headers["Content-Disposition"]


@pytest.mark.parametrize("mime", ["text/html", "image/svg+xml", "application/xhtml+xml"])
def test_scriptable_types_are_served_as_opaque_bytes(client, stored_file, mime):
    node = stored_file("page", b"<script>alert(1)</script>", mime)
    with fetch(client.get(download(node.pk)).json()["url"]) as file:
        assert file.headers["Content-Type"] == "application/octet-stream"
        assert file.headers["Content-Disposition"].startswith("attachment;")


@pytest.mark.parametrize(
    ("mime", "served"),
    [
        ("image/png", "image/png"),
        ("Text/HTML; charset=utf-8", "application/octet-stream"),
        ("application/rss+xml", "application/octet-stream"),
        ("application/x-javascript", "application/octet-stream"),
        ("", "application/octet-stream"),
    ],
)
def test_safe_content_type(mime, served):
    assert safe_content_type(mime) == served


def test_folders_and_others_files_cannot_be_downloaded(client, api_client, root, stored_file):
    response = client.get(download(root.pk))
    assert (response.status_code, response.json()["error"]["code"]) == (400, "not_a_file")
    node = stored_file("a.txt", b"x", "text/plain")
    api_client.force_authenticate(User.objects.create_user("other@example.com"))
    assert api_client.get(download(node.pk)).status_code == 404


def test_trashed_files_and_anonymous_users(client, stored_file):
    node = stored_file("a.txt", b"x", "text/plain")
    Node.objects.filter(pk=node.pk).update(trashed_at=timezone.now(), trashed_root=node)
    assert client.get(download(node.pk)).status_code == 404
    client.force_authenticate(None)
    response = client.get(download(node.pk))
    assert (response.status_code, response.json()["error"]["code"]) == (403, "not_authenticated")
