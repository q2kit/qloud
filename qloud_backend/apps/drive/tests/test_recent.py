import datetime
from urllib.parse import urlsplit

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.drive.models import Node
from apps.drive.selectors import RECENT_LIMIT, recent_files

pytestmark = pytest.mark.django_db
URL = "/api/v1/recent"


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user)
    return api_client


def test_auth_required(api_client):
    assert api_client.get(URL).status_code == 403


def test_empty(client):
    assert client.get(URL).json() == {"results": [], "next": None, "previous": None}


def test_only_own_live_files(client, user, root, make_file, django_assert_num_queries):
    mine = make_file("mine.txt")
    deleted = make_file("deleted.txt")
    deleted.trashed_at = timezone.now()
    deleted.trashed_root = deleted
    deleted.save()
    other = User.objects.create_user("other@example.com")
    Node.objects.create(owner=other, parent=other.root_folder, kind="file", name="private.txt")
    Node.objects.create(owner=user, parent=root, name="folder")
    with django_assert_num_queries(1):
        response = client.get(URL)
    assert response.status_code == 200
    assert [row["id"] for row in response.json()["results"]] == [str(mine.pk)]
    assert response.json()["results"][0]["parent_id"] == str(root.pk)


def test_selector_refuses_suspended_user(user, make_file):
    make_file()
    user.suspended_at = timezone.now()
    assert list(recent_files(user)) == []


def test_sort_and_bidirectional_cursor_with_ties(client, make_file):
    files = [make_file(f"{i}.txt") for i in range(7)]
    now = timezone.now()
    Node.objects.filter(pk__in=[file.pk for file in files]).update(updated_at=now)
    Node.objects.filter(pk=files[0].pk).update(updated_at=now + datetime.timedelta(days=1))
    expected = [files[0].pk, *sorted([file.pk for file in files[1:]], reverse=True)]
    pages = []
    url = URL + "?page_size=2"
    ids: list[str] = []
    while url:
        response = client.get(url)
        assert response.status_code == 200
        body = response.json()
        ids.extend(row["id"] for row in body["results"])
        pages.append(body)
        url = body["next"]
    assert ids == [str(pk) for pk in expected]
    back = client.get(pages[1]["previous"]).json()
    assert back["results"] == pages[0]["results"]


def test_limit_applies_across_pages(client, make_file, django_assert_num_queries):
    files = [make_file(f"{i}.txt") for i in range(RECENT_LIMIT + 5)]
    expected = sorted(files, key=lambda node: (node.updated_at, node.pk), reverse=True)[
        :RECENT_LIMIT
    ]
    url = URL + "?page_size=30"
    ids: list[str] = []
    while url:
        with django_assert_num_queries(1):
            body = client.get(url).json()
        ids.extend(row["id"] for row in body["results"])
        url = body["next"]
    assert ids == [str(node.pk) for node in expected]
    assert len(ids) == RECENT_LIMIT
    assert len(client.get(URL + "?page_size=200").json()["results"]) == RECENT_LIMIT


@pytest.mark.parametrize("query", ["page_size=0", "page_size=-1", "page_size=no", "ordering=name"])
def test_invalid_query(client, query):
    assert client.get(URL + "?" + query).status_code == 400


def test_invalid_cursor_and_children_cursor(client, root, make_file):
    make_file("a.txt")
    make_file("b.txt")
    assert client.get(URL + "?cursor=garbage").status_code == 404
    link = client.get(f"/api/v1/nodes/{root.pk}/children?page_size=1").json()["next"]
    assert client.get(URL + "?" + urlsplit(link).query).status_code == 404


def test_rename_and_move_update_recency(client, root, make_file):
    first = make_file("first.txt")
    second = make_file("second.txt")
    assert client.get(URL).json()["results"][0]["id"] == str(second.pk)
    assert (
        client.patch(
            f"/api/v1/nodes/{first.pk}", {"name": "renamed.txt"}, format="json"
        ).status_code
        == 200
    )
    assert client.get(URL).json()["results"][0]["id"] == str(first.pk)
    folder = Node.objects.create(owner_id=root.owner_id, parent=root, name="Target")
    assert (
        client.post(
            "/api/v1/nodes/move",
            {"node_ids": [str(second.pk)], "target_parent_id": str(folder.pk)},
            format="json",
        ).status_code
        == 200
    )
    assert client.get(URL).json()["results"][0]["id"] == str(second.pk)
