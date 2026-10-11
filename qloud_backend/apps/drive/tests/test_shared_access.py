from typing import Any

import pytest
from allauth.account.models import EmailAddress

from apps.accounts.models import User
from apps.drive.models import Node
from apps.sharing.models import Share
from apps.uploads.models import UploadSession

pytestmark = pytest.mark.django_db


@pytest.fixture
def shared(user, root, api_client):
    private = Node.objects.create(owner=user, parent=root, name="Private")
    folder = Node.objects.create(owner=user, parent=private, name="Shared")
    child = Node.objects.create(owner=user, parent=folder, name="Child")
    recipient = User.objects.create_user("recipient@example.com")
    EmailAddress.objects.create(user=recipient, email=recipient.email, verified=True, primary=True)
    api_client.force_authenticate(recipient)
    return folder, child, recipient, api_client


@pytest.mark.parametrize("role", ["viewer", "editor"])
@pytest.mark.parametrize("direct", [False, True])
def test_shared_read_and_write_api(
    user, shared, make_file, role, direct, django_assert_max_num_queries
):
    folder, child, recipient, client = shared
    Share.objects.create(
        node=child if direct else folder, grantee=recipient, created_by=user, role=role
    )
    file = make_file(parent=child)
    detail = client.get(f"/api/v1/nodes/{child.pk}")
    assert detail.status_code == 200
    assert [n["id"] for n in detail.json()["breadcrumb"]] == ([] if direct else [str(folder.pk)])
    assert detail.json()["capabilities"]["can_edit"] == (role == "editor")
    with django_assert_max_num_queries(3):
        response = client.get(f"/api/v1/nodes/{child.pk}/children")
    assert response.status_code == 200
    assert [n["id"] for n in response.json()["results"]] == [str(file.pk)]
    for action in ["download", "preview"]:
        assert client.get(f"/api/v1/nodes/{file.pk}/{action}").status_code == 200
    expected = 201 if role == "editor" else 404
    created = client.post(
        "/api/v1/folders", {"parent_id": str(child.pk), "name": "New"}, format="json"
    )
    assert created.status_code == expected
    if role == "editor":
        assert Node.objects.get(pk=created.json()["id"]).owner == user
    assert client.patch(
        f"/api/v1/nodes/{file.pk}", {"name": "renamed.txt"}, format="json"
    ).status_code == (200 if role == "editor" else 404)
    assert (
        client.post(
            "/api/v1/uploads",
            {
                "parent_id": str(child.pk),
                "filename": "upload.txt",
                "size": 0,
                "mime_type": "text/plain",
                "fingerprint": "shared",
            },
            format="json",
        ).status_code
        == expected
    )
    if role == "editor":
        session = UploadSession.objects.get(user=recipient)
        assert [p["name"] for p in session.parent_path] == (
            ["Child"] if direct else ["Shared", "Child"]
        )
        assert session.owner == user
        done = client.post(f"/api/v1/uploads/{session.pk}/complete")
        assert done.status_code == 200, done.json()
        assert Node.objects.get(pk=done.json()["id"]).owner == user
    assert client.get(f"/api/v1/nodes/{user.root_folder_id}").status_code == 404


def test_editor_moves_stay_in_same_grant(user, shared):
    folder, child, recipient, client = shared
    Share.objects.create(node=folder, grantee=recipient, created_by=user, role="editor")
    outside = Node.objects.create(owner=user, parent=user.root_folder, name="Other share")
    Share.objects.create(node=outside, grantee=recipient, created_by=user, role="editor")

    def move(node: Node, target: Node) -> Any:
        return client.post(
            "/api/v1/nodes/move",
            {
                "node_ids": [str(node.pk)],
                "target_parent_id": str(target.pk),
            },
            format="json",
        )

    assert move(child, outside).status_code == 400
    assert move(folder, outside).status_code == 400
    destination = Node.objects.create(owner=user, parent=folder, name="Destination")
    assert move(child, destination).status_code == 200
    child.refresh_from_db()
    assert child.parent == destination
    Share.objects.create(node=user.root_folder, grantee=recipient, created_by=user, role="editor")
    assert move(child, outside).status_code == 200


@pytest.mark.parametrize("role", ["viewer", "editor"])
def test_shared_trash_owner_only_restore_delete(user, shared, role):
    folder, child, recipient, client = shared
    share = Share.objects.create(node=folder, grantee=recipient, created_by=user, role=role)
    response = client.post("/api/v1/nodes/trash", {"node_ids": [str(child.pk)]}, format="json")
    assert response.status_code == (200 if role == "editor" else 404)
    child.refresh_from_db()
    if role == "viewer":
        assert child.trashed_at is None
        return
    assert child.trashed_by == recipient
    assert [n["id"] for n in response.json()["nodes"]] == [str(child.pk)]
    assert client.get(f"/api/v1/nodes/{child.pk}").status_code == 404
    assert client.get("/api/v1/trash").json()["results"] == []
    for action in ["restore", "delete"]:
        assert (
            client.post(
                f"/api/v1/trash/{action}", {"node_ids": [str(child.pk)]}, format="json"
            ).status_code
            == 404
        )
    client.force_authenticate(user)
    assert (
        client.post(
            "/api/v1/trash/restore", {"node_ids": [str(child.pk)]}, format="json"
        ).status_code
        == 200
    )
    client.force_authenticate(recipient)
    assert client.get(f"/api/v1/nodes/{child.pk}").status_code == 200
    share.delete()
    assert client.get(f"/api/v1/nodes/{child.pk}").status_code == 404


def test_editor_trash_handles_multiple_owners_atomically(user, shared):
    folder, child, recipient, client = shared
    second = User.objects.create_user("second@example.com")
    other = Node.objects.create(owner=second, parent=second.root_folder, name="Other")
    Share.objects.create(node=folder, grantee=recipient, created_by=user, role="editor")
    Share.objects.create(node=other, grantee=recipient, created_by=second, role="viewer")
    selection = {"node_ids": [str(child.pk), str(other.pk)]}
    assert client.post("/api/v1/nodes/trash", selection, format="json").status_code == 404
    child.refresh_from_db()
    assert child.trashed_at is None
    Share.objects.filter(node=other).update(role="editor")
    assert client.post("/api/v1/nodes/trash", selection, format="json").status_code == 200
    other.refresh_from_db()
    assert other.trashed_by == recipient
