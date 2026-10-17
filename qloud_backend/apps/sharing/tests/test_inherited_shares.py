"""M8-10: grants inherited from ancestors, and the owner on a node's detail."""

import pytest

from apps.accounts.models import User
from apps.drive.models import Node
from apps.drive.trash import trash
from apps.sharing.models import Share

pytestmark = pytest.mark.django_db


@pytest.fixture
def tree(api_client):
    """Drive > Outer > Inner > file, with a grant on each level.

    The editor's access comes from Inner, so Outer is outside what they can see.
    """
    users = {
        name: User.objects.create_user(f"{name}@example.com")
        for name in ["owner", "editor", "viewer", "outer_guest", "file_guest", "outside"]
    }
    owner = users["owner"]
    outer = Node.objects.create(owner=owner, parent=owner.root_folder, name="Outer")
    inner = Node.objects.create(owner=owner, parent=outer, name="Inner")
    file = Node.objects.create(owner=owner, parent=inner, name="a.txt", kind=Node.Kind.FILE)
    grants = {
        "outer": Share.objects.create(
            node=outer, grantee=users["outer_guest"], created_by=owner, role="viewer"
        ),
        "editor": Share.objects.create(
            node=inner, grantee=users["editor"], created_by=owner, role="editor"
        ),
        "viewer": Share.objects.create(
            node=inner, grantee=users["viewer"], created_by=owner, role="viewer"
        ),
        "file": Share.objects.create(
            node=file, grantee=users["file_guest"], created_by=owner, role="viewer"
        ),
    }
    return users, file, grants, api_client


def listed(client, node: Node, query: str = "") -> set[str]:
    response = client.get(f"/api/v1/nodes/{node.pk}/shares{query}")
    assert response.status_code == 200, response.content
    return {row["id"] for row in response.json()["results"]}


def ids(*shares: Share) -> set[str]:
    return {str(share.pk) for share in shares}


def test_owner_sees_grants_on_every_ancestor(tree):
    users, file, grants, client = tree
    client.force_authenticate(users["owner"])
    assert listed(client, file) == ids(grants["file"])
    assert listed(client, file, "?include_inherited=false") == ids(grants["file"])
    assert listed(client, file, "?include_inherited=true") == ids(*grants.values())


def test_inherited_rows_keep_the_node_they_are_on(tree):
    users, file, grants, client = tree
    client.force_authenticate(users["owner"])
    rows = client.get(f"/api/v1/nodes/{file.pk}/shares?include_inherited=true").json()["results"]
    by_id = {row["id"]: row["node_id"] for row in rows}
    assert by_id[str(grants["file"].pk)] == str(file.pk)
    assert by_id[str(grants["outer"].pk)] == str(grants["outer"].node_id)


def test_editor_sees_only_ancestors_they_can_see(tree):
    users, file, grants, client = tree
    client.force_authenticate(users["editor"])
    assert listed(client, file, "?include_inherited=true") == ids(
        grants["editor"], grants["viewer"], grants["file"]
    )


@pytest.mark.parametrize("actor", ["viewer", "outside"])
def test_no_inherited_grants_without_edit_access(tree, actor):
    users, file, _grants, client = tree
    client.force_authenticate(users[actor])
    response = client.get(f"/api/v1/nodes/{file.pk}/shares?include_inherited=true")
    assert response.status_code == 404
    # Access is checked before the query parameter.
    response = client.get(f"/api/v1/nodes/{file.pk}/shares?include_inherited=maybe")
    assert response.status_code == 404


def test_anonymous_is_refused(tree):
    _users, file, _grants, client = tree
    response = client.get(f"/api/v1/nodes/{file.pk}/shares?include_inherited=true")
    assert response.status_code == 403


def test_rejects_a_malformed_flag(tree):
    users, file, _grants, client = tree
    client.force_authenticate(users["owner"])
    response = client.get(f"/api/v1/nodes/{file.pk}/shares?include_inherited=maybe")
    assert response.status_code == 400


def test_trashed_node_is_not_found(tree):
    users, file, _grants, client = tree
    trash(users["owner"], [file.pk])
    client.force_authenticate(users["owner"])
    response = client.get(f"/api/v1/nodes/{file.pk}/shares?include_inherited=true")
    assert response.status_code == 404


@pytest.mark.parametrize("actor", ["owner", "editor"])
def test_query_count_does_not_grow_with_grants(tree, actor, django_assert_max_num_queries):
    users, file, _grants, client = tree
    owner = users["owner"]
    for index in range(20):
        guest = User.objects.create_user(f"guest{index}@example.com")
        Share.objects.create(node=file, grantee=guest, created_by=owner, role="viewer")
    client.force_authenticate(users[actor])
    with django_assert_max_num_queries(8):
        response = client.get(f"/api/v1/nodes/{file.pk}/shares?include_inherited=true")
    assert response.status_code == 200
    assert len(response.json()["results"]) > 20


@pytest.mark.parametrize("actor", ["owner", "editor", "viewer"])
def test_detail_names_the_owner_without_email(tree, actor):
    users, file, _grants, client = tree
    client.force_authenticate(users[actor])
    owner = users["owner"]
    response = client.get(f"/api/v1/nodes/{file.pk}")
    assert response.status_code == 200
    assert response.json()["owner"] == {"id": str(owner.pk), "display_name": owner.display_name}
