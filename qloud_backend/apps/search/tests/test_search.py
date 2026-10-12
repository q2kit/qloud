import datetime
import unicodedata
from typing import Any
from urllib.parse import urlsplit

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.drive.models import Node
from apps.search.selectors import normalized_query, search_nodes
from apps.sharing.models import Share

pytestmark = pytest.mark.django_db
URL = "/api/v1/search"


@pytest.fixture
def user():
    return User.objects.create_user("search@example.com")


@pytest.fixture
def client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def node(user):
    def make(name, *, owner=None, parent=None, mime="text/plain", kind="file"):
        owner = owner or user
        return Node.objects.create(
            owner=owner,
            parent=parent or owner.root_folder,
            name=name,
            kind=kind,
            mime_type=mime if kind == "file" else None,
        )

    return make


def ids(response: Any) -> list[str]:
    assert response.status_code == 200, response.content
    return [row["id"] for row in response.json()["results"]]


def test_authentication_and_suspension(client, user, node):
    node("report")
    assert APIClient().get(URL, {"q": "report"}).status_code == 403
    user.suspended_at = timezone.now()
    user.save(update_fields=["suspended_at"])
    assert ids(client.get(URL, {"q": "report"})) == []


@pytest.mark.parametrize("query", ["bao cao", "BÁO CÁO", unicodedata.normalize("NFD", "Báo cáo")])
def test_accents_case_and_normalization(client, node, query):
    report = node(unicodedata.normalize("NFD", "Báo cáo Q3.pdf"), mime="application/pdf")
    assert ids(client.get(URL, {"q": query})) == [str(report.pk)]
    node("Đường dẫn")
    assert len(ids(client.get(URL, {"q": "duong dan"}))) == 1


def test_trigger_bulk_update_short_names_wildcards_and_long_expansion(client, node):
    report = node("before")
    Node.objects.filter(pk=report.pk).update(name="A%_B")
    assert ids(client.get(URL, {"q": "%_"})) == [str(report.pk)]
    node("AXXB")
    assert len(ids(client.get(URL, {"q": "%_"}))) == 1
    report.refresh_from_db()
    assert report.search_name == "a%_b"
    long = node("Æ" * 255)
    long.refresh_from_db()
    assert len(long.search_name) == 510


def test_permissions_inheritance_revocation_trash_and_metadata(
    client, user, node, django_assert_max_num_queries
):
    other = User.objects.create_user("other-search@example.com", display_name="Other")
    own = node("report own")
    folder = node("report shared", owner=other, kind="folder")
    child = node("report child", owner=other, parent=folder)
    node("report secret", owner=other)
    direct = node("report direct", owner=other)
    grants = [
        Share.objects.create(node=n, grantee=user, created_by=other, role=role)
        for n, role in [(folder, "viewer"), (direct, "editor")]
    ]
    with django_assert_max_num_queries(4):
        response = client.get(URL, {"q": "report"})
    assert set(ids(response)) == {str(n.pk) for n in (own, folder, child, direct)}
    roles = {row["id"]: row["effective_role"] for row in response.json()["results"]}
    assert roles == {
        str(own.pk): "owner",
        str(folder.pk): "viewer",
        str(child.pk): "viewer",
        str(direct.pk): "editor",
    }
    assert next(row for row in response.json()["results"] if row["id"] == str(child.pk))[
        "owner"
    ] == {"id": str(other.pk), "display_name": "Other"}
    grants[0].delete()
    assert set(ids(client.get(URL, {"q": "report"}))) == {str(own.pk), str(direct.pk)}
    direct.trashed_at = timezone.now()
    direct.trashed_root = direct
    direct.save()
    assert ids(client.get(URL, {"q": "report"})) == [str(own.pk)]
    user.suspended_at = timezone.now()
    assert list(search_nodes(user, normalized_query("report"))) == []


@pytest.mark.parametrize(
    ("kind", "mime"),
    [
        ("folder", None),
        ("document", "text/plain"),
        ("document", "application/pdf"),
        ("document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ("image", "image/png"),
        ("video", "video/mp4"),
        ("audio", "audio/mpeg"),
        ("archive", "application/zip"),
        ("other", "application/octet-stream"),
        ("other", None),
    ],
)
def test_types(client, node, kind, mime):
    expected = node("report.txt", kind="folder" if kind == "folder" else "file", mime=mime)
    assert ids(client.get(URL, {"q": "report", "type": kind})) == [str(expected.pk)]
    assert (
        ids(client.get(URL, {"q": "report", "type": "video" if kind != "video" else "folder"}))
        == []
    )


def test_owner_modified_after_rank_and_fuzzy(client, user, node):
    own = node("report")
    prefix = node("report draft")
    fuzzy = node("reporx")
    other = User.objects.create_user("filter@example.com")
    shared = node("old report", owner=other)
    Share.objects.create(node=shared, grantee=user, created_by=other, role="viewer")
    now = timezone.now()
    Node.objects.filter(pk=shared.pk).update(updated_at=now - datetime.timedelta(days=1))
    rows = ids(client.get(URL, {"q": "report"}))
    assert rows[:2] == [str(own.pk), str(prefix.pk)]
    assert str(fuzzy.pk) in rows
    assert ids(client.get(URL, {"q": "report", "owner": "others"})) == [str(shared.pk)]
    assert str(shared.pk) not in ids(client.get(URL, {"q": "report", "owner": "me"}))
    assert str(shared.pk) not in ids(
        client.get(URL, {"q": "report", "modified_after": now.isoformat()})
    )


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"q": " "},
        {"q": "a" * 256},
        {"q": "x", "type": "bad"},
        {"q": "x", "owner": "bad"},
        {"q": "x", "modified_after": "2026-01-01"},
        {"q": "x", "modified_after": "2026-01-01T00:00:00"},
        {"q": "x", "modified_after": "bad"},
        {"q": "x", "page_size": "0"},
    ],
)
def test_invalid_filters(client, params):
    assert client.get(URL, params).status_code == 400


def test_cursor_ties_bidirectional_binding_and_query_count(
    client, node, django_assert_max_num_queries
):
    nodes = [node(f"report {i}") for i in range(12)]
    Node.objects.filter(pk__in=[n.pk for n in nodes]).update(updated_at=timezone.now())
    expected = ids(client.get(URL, {"q": "report"}))
    page = client.get(URL, {"q": "report", "page_size": 3}).json()
    first = page
    all_ids = [n["id"] for n in page["results"]]
    while page["next"]:
        with django_assert_max_num_queries(4):
            response = client.get(page["next"])
        page = response.json()
        all_ids.extend(ids(response))
    assert all_ids == expected
    second = client.get(first["next"]).json()
    assert client.get(second["previous"]).json()["results"] == first["results"]
    cursor = urlsplit(first["next"]).query
    assert client.get(URL + "?" + cursor.replace("q=report", "q=other")).status_code == 404
    assert client.get(URL, {"q": "report", "cursor": "garbage"}).status_code == 404
