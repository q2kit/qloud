import urllib.request
from dataclasses import dataclass

import pytest
from allauth.account.models import EmailAddress
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.drive.models import Blob, FileVersion, Node
from apps.drive.trash import trash
from apps.sharing.models import Share, ShareLink
from apps.uploads.models import UploadSession

pytestmark = pytest.mark.django_db
ACTORS = ["owner", "editor", "viewer", "outside", None]


@dataclass
class Matrix:
    users: dict[str, User]
    scope: Node
    folder: Node
    file: Node
    destination: Node
    child: Node
    client: APIClient
    inherited: bool

    def authenticate(self, actor: str | None) -> None:
        self.client.force_authenticate(self.users[actor] if actor else None)


@pytest.fixture(params=[False, True], ids=["direct", "inherited"])
def matrix(request, api_client):
    users = {role: User.objects.create_user(f"{role}@example.com") for role in ACTORS if role}
    for user in users.values():
        EmailAddress.objects.create(user=user, email=user.email, primary=True, verified=True)
    owner = users["owner"]
    scope = Node.objects.create(owner=owner, parent=owner.root_folder, name="Scope")
    folder = Node.objects.create(owner=owner, parent=scope, name="Folder")
    child = Node.objects.create(owner=owner, parent=folder, name="Child")
    destination = Node.objects.create(owner=owner, parent=scope, name="Destination")
    file = Node.objects.create(
        owner=owner, parent=scope, name="File.txt", kind="file", size=3, mime_type="text/plain"
    )
    blob = Blob.objects.create(storage_key=f"blobs/{file.pk}", size=3, etag="e")
    file.current_version = FileVersion.objects.create(
        node=file, blob=blob, version_number=1, size=3, mime_type="text/plain",
        uploaded_by=owner, original_name=file.name,
    )  # fmt: skip
    file.save()
    owner.used_bytes = 3
    owner.save(update_fields=["used_bytes"])
    for role in ["editor", "viewer"]:
        for node in [scope] if request.param else [folder, file, destination]:
            Share.objects.create(node=node, grantee=users[role], role=role, created_by=owner)
    return Matrix(users, scope, folder, file, destination, child, api_client, request.param)


def state() -> dict[str, object]:
    return {
        "nodes": list(
            Node.objects.order_by("pk").values(
                "id",
                "owner_id",
                "parent_id",
                "kind",
                "name",
                "size",
                "current_version_id",
                "trashed_at",
                "trashed_root_id",
                "trashed_by_id",
            )
        ),
        "quota": list(User.objects.order_by("pk").values("id", "used_bytes", "reserved_bytes")),
        "shares": list(Share.objects.order_by("pk").values("id", "node_id", "grantee_id", "role")),
        "links": list(ShareLink.objects.order_by("pk").values("id", "revoked_at", "revoke_reason")),
        "uploads": list(UploadSession.objects.order_by("pk").values("id", "status", "node_id")),
        "versions": list(FileVersion.objects.order_by("pk").values("id", "node_id", "blob_id")),
        "blobs": list(Blob.objects.order_by("pk").values("id", "storage_key", "size")),
    }


def upload_payload(folder: Node, size: int = 3) -> dict[str, object]:
    return {
        "parent_id": str(folder.pk),
        "filename": "Uploaded.txt",
        "size": size,
        "mime_type": "text/plain",
        "fingerprint": "matrix",
    }


@pytest.mark.parametrize("actor", ACTORS)
@pytest.mark.parametrize(
    ("operation", "kind"),
    [
        ("detail", "folder"),
        ("detail", "file"),
        ("children", "folder"),
        ("children", "file"),
        ("download", "file"),
        ("preview", "file"),
        ("create", "folder"),
        ("upload", "folder"),
        ("rename", "folder"),
        ("rename", "file"),
        ("move", "folder"),
        ("move", "file"),
        ("trash", "folder"),
        ("trash", "file"),
    ],
)
def test_node_operation_matrix(matrix, actor, operation, kind, bucket):
    matrix.authenticate(actor)
    node = matrix.folder if kind == "folder" else matrix.file
    client = matrix.client
    read = operation in {"detail", "children", "download", "preview"}
    permitted = actor in ({"owner", "editor", "viewer"} if read else {"owner", "editor"})
    expected = (
        (201 if operation in {"create", "upload"} else 200)
        if permitted
        else (403 if actor is None else 404)
    )
    # Separate editor grants do not authorize a move between their roots.
    if operation == "move" and actor == "editor" and not matrix.inherited:
        expected = 400
    before = state()
    path = f"/api/v1/nodes/{node.pk}"
    match operation:
        case "detail":
            response = client.get(path)
        case "children" | "download" | "preview":
            response = client.get(f"{path}/{operation}")
        case "create":
            response = client.post(
                "/api/v1/folders",
                {
                    "parent_id": str(node.pk),
                    "name": "Created",
                },
                format="json",
            )
        case "upload":
            response = client.post("/api/v1/uploads", upload_payload(node), format="json")
        case "rename":
            response = client.patch(path, {"name": "Renamed"}, format="json")
        case "move":
            response = client.post(
                "/api/v1/nodes/move",
                {
                    "node_ids": [str(node.pk)],
                    "target_parent_id": str(matrix.destination.pk),
                },
                format="json",
            )
        case "trash":
            response = client.post(
                "/api/v1/nodes/trash",
                {
                    "node_ids": [str(node.pk)],
                },
                format="json",
            )
        case _:
            raise AssertionError(operation)
    assert response.status_code == expected, response.json()
    if expected >= 400 or read:
        assert state() == before
    if expected >= 400:
        code = (
            "not_authenticated"
            if actor is None
            else "invalid_move"
            if expected == 400
            else "not_found"
        )
        assert response.json()["error"]["code"] == code
        return
    body = response.json()
    if operation == "detail":
        assert body["id"] == str(node.pk)
        assert body["capabilities"] == {
            **dict.fromkeys(["can_edit", "can_trash", "can_share"], actor in {"owner", "editor"}),
            "can_delete_versions": actor == "owner" and node.kind == "file",
        }
        ancestors = [matrix.scope.pk] if matrix.inherited else []
        if actor == "owner":
            ancestors = [matrix.users["owner"].root_folder_id, matrix.scope.pk]
        assert [crumb["id"] for crumb in body["breadcrumb"]] == list(map(str, ancestors))
    elif operation == "children":
        assert [row["id"] for row in body["results"]] == (
            [str(matrix.child.pk)] if kind == "folder" else []
        )
    elif operation in {"download", "preview"}:
        assert "X-Amz-Signature=" in body["url"]
    elif operation == "create":
        created = Node.objects.get(pk=body["id"])
        assert (created.owner_id, created.parent_id) == (node.owner_id, node.pk)
    elif operation == "upload":
        session = UploadSession.objects.get(pk=body["id"])
        assert (session.user_id, session.owner_id) == (matrix.users[actor].pk, node.owner_id)
        owner = matrix.users["owner"]
        owner.refresh_from_db()
        assert (owner.used_bytes, owner.reserved_bytes) == (3, 3)
        assert client.delete(f"/api/v1/uploads/{session.pk}").status_code == 204
        owner.refresh_from_db()
        assert (owner.used_bytes, owner.reserved_bytes) == (3, 0)
    else:
        node.refresh_from_db()
        if operation == "rename":
            assert node.name == "Renamed"
        elif operation == "move":
            assert node.parent_id == matrix.destination.pk
        else:
            assert node.trashed_at is not None
            assert node.trashed_by_id == matrix.users[actor].pk
            if kind == "folder":
                matrix.child.refresh_from_db()
                assert matrix.child.trashed_root_id == node.pk


@pytest.mark.parametrize("actor", ACTORS)
@pytest.mark.parametrize("kind", ["folder", "file"])
@pytest.mark.parametrize("operation", ["restore", "delete", "thumbnail"])
def test_trash_is_owner_only(matrix, actor, kind, operation):
    node = matrix.folder if kind == "folder" else matrix.file
    trash(matrix.users["owner"], [node.pk])
    matrix.authenticate(actor)
    before = state()
    for suffix in ["", "/children", "/download", "/preview"]:
        response = matrix.client.get(f"/api/v1/nodes/{node.pk}{suffix}")
        assert response.status_code == (403 if actor is None else 404)
    if operation == "thumbnail":
        response = matrix.client.get(f"/api/v1/nodes/{node.pk}/preview?trashed_thumbnail=true")
        expected = (
            (400 if kind == "folder" else 200)
            if actor == "owner"
            else (403 if actor is None else 404)
        )
    else:
        response = matrix.client.post(
            f"/api/v1/trash/{operation}",
            {
                "node_ids": [str(node.pk)],
            },
            format="json",
        )
        expected = (
            (204 if operation == "delete" else 200)
            if actor == "owner"
            else (403 if actor is None else 404)
        )
    assert response.status_code == expected, response.json()
    if expected >= 400 or operation == "thumbnail":
        assert state() == before
    elif operation == "delete":
        assert not Node.objects.filter(pk=node.pk).exists()
        owner = matrix.users["owner"]
        owner.refresh_from_db()
        assert (owner.used_bytes, owner.reserved_bytes) == (0 if kind == "file" else 3, 0)
    else:
        node.refresh_from_db()
        assert node.trashed_at is None


@pytest.mark.parametrize("operation", ["move", "trash"])
@pytest.mark.parametrize("actor", ["editor", "viewer"])
def test_mixed_permission_batch_is_atomic(matrix, operation, actor):
    forbidden = Node.objects.create(
        owner=matrix.users["owner"], parent=matrix.users["owner"].root_folder, name="Forbidden"
    )
    matrix.authenticate(actor)
    before = state()
    payload: dict[str, object] = {"node_ids": [str(matrix.file.pk), str(forbidden.pk)]}
    if operation == "move":
        payload["target_parent_id"] = str(matrix.destination.pk)
    response = matrix.client.post(f"/api/v1/nodes/{operation}", payload, format="json")
    assert response.status_code == 404
    assert state() == before


@pytest.mark.parametrize("actor", ["owner", "editor", "viewer"])
def test_children_query_budget_does_not_grow_with_shared_items(
    matrix, actor, django_assert_max_num_queries
):
    for i in range(30):
        Node.objects.create(owner=matrix.users["owner"], parent=matrix.folder, name=f"Child {i:02}")
    matrix.authenticate(actor)
    with django_assert_max_num_queries(3):
        response = matrix.client.get(f"/api/v1/nodes/{matrix.folder.pk}/children?page_size=10")
    assert response.status_code == 200
    assert len(response.json()["results"]) == 10
    assert response.json()["next"] is not None


def upload_part(client: APIClient, path: str) -> None:
    parts = client.post(f"{path}/parts", {"part_numbers": [1]}, format="json")
    assert parts.status_code == 200
    request = urllib.request.Request(parts.json()["parts"][0]["url"], data=b"new", method="PUT")  # noqa: S310
    with urllib.request.urlopen(request, timeout=10) as uploaded:  # noqa: S310
        assert uploaded.status == 200


@pytest.mark.parametrize("actor", ACTORS)
@pytest.mark.parametrize("operation", ["detail", "parts", "complete", "abort"])
def test_upload_session_belongs_to_creator_not_folder_owner(matrix, actor, operation, bucket):
    matrix.authenticate("editor")
    created = matrix.client.post("/api/v1/uploads", upload_payload(matrix.folder), format="json")
    assert created.status_code == 201
    session_id = created.json()["id"]
    path = f"/api/v1/uploads/{session_id}"
    if actor == "editor" and operation == "complete":
        upload_part(matrix.client, path)
    matrix.authenticate(actor)
    before = state()
    if operation == "detail":
        response = matrix.client.get(path)
    elif operation == "abort":
        response = matrix.client.delete(path)
    else:
        response = matrix.client.post(
            f"{path}/{operation}",
            {"part_numbers": [1]} if operation == "parts" else {},
            format="json",
        )
    expected = (
        (204 if operation == "abort" else 200)
        if actor == "editor"
        else (403 if actor is None else 404)
    )
    assert response.status_code == expected, response.content
    if expected >= 400 or operation in {"detail", "parts"}:
        assert state() == before
    if actor == "editor" and operation == "complete":
        node = Node.objects.get(pk=response.json()["id"])
        assert (node.owner_id, node.parent_id) == (matrix.users["owner"].pk, matrix.folder.pk)
        assert node.current_version is not None
        assert node.current_version.uploaded_by_id == matrix.users["editor"].pk
        link = matrix.client.get(f"/api/v1/nodes/{node.pk}/download").json()["url"]
        with urllib.request.urlopen(link, timeout=10) as downloaded:  # noqa: S310
            assert downloaded.read() == b"new"
        owner = matrix.users["owner"]
        owner.refresh_from_db()
        assert (owner.used_bytes, owner.reserved_bytes) == (6, 0)
    else:
        matrix.authenticate("editor")
        assert matrix.client.delete(path).status_code == 204
        owner = matrix.users["owner"]
        owner.refresh_from_db()
        assert (owner.used_bytes, owner.reserved_bytes) == (3, 0)


@pytest.mark.parametrize("lost", ["revoke", "downgrade"])
def test_upload_complete_rechecks_edit_permission_and_releases_quota(matrix, lost, bucket):
    matrix.authenticate("editor")
    created = matrix.client.post("/api/v1/uploads", upload_payload(matrix.folder), format="json")
    assert created.status_code == 201
    upload_part(matrix.client, f"/api/v1/uploads/{created.json()['id']}")
    owner = matrix.users["owner"]
    owner.refresh_from_db()
    assert owner.reserved_bytes == 3
    grant = Share.objects.get(
        node=matrix.scope if matrix.inherited else matrix.folder,
        grantee=matrix.users["editor"],
    )
    matrix.authenticate("owner")
    if lost == "revoke":
        response = matrix.client.delete(f"/api/v1/shares/{grant.pk}")
        assert response.status_code == 204
    else:
        response = matrix.client.patch(
            f"/api/v1/shares/{grant.pk}", {"role": "viewer"}, format="json"
        )
        assert response.status_code == 200
    before = list(Node.objects.order_by("pk").values_list("pk", flat=True))
    matrix.authenticate("editor")
    response = matrix.client.post(f"/api/v1/uploads/{created.json()['id']}/complete")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "target_unavailable"
    assert list(Node.objects.order_by("pk").values_list("pk", flat=True)) == before
    session = UploadSession.objects.get(pk=created.json()["id"])
    assert session.status == UploadSession.Status.ABORTED
    owner = matrix.users["owner"]
    owner.refresh_from_db()
    assert (owner.used_bytes, owner.reserved_bytes) == (3, 0)


def test_highest_role_changes_take_effect_on_next_api_request(matrix):
    editor = matrix.users["editor"]
    source = matrix.scope if matrix.inherited else matrix.file
    fallback = matrix.file if matrix.inherited else matrix.scope
    grant = Share.objects.get(node=source, grantee=editor)
    matrix.authenticate("owner")
    created = matrix.client.post(
        f"/api/v1/nodes/{fallback.pk}/shares",
        {
            "email": editor.email,
            "role": "viewer",
        },
        format="json",
    )
    assert created.status_code == 201
    matrix.authenticate("editor")
    path = f"/api/v1/nodes/{matrix.file.pk}"
    assert matrix.client.get(path).json()["capabilities"]["can_edit"] is True
    matrix.authenticate("owner")
    assert (
        matrix.client.patch(
            f"/api/v1/shares/{grant.pk}", {"role": "viewer"}, format="json"
        ).status_code
        == 200
    )
    matrix.authenticate("editor")
    assert matrix.client.get(path).json()["capabilities"]["can_edit"] is False
    before = state()
    assert matrix.client.patch(path, {"name": "Forbidden"}, format="json").status_code == 404
    assert state() == before
    matrix.authenticate("owner")
    assert matrix.client.delete(f"/api/v1/shares/{grant.pk}").status_code == 204
    matrix.authenticate("editor")
    for suffix in ["", "/download", "/preview"]:
        assert matrix.client.get(path + suffix).status_code == 200
    matrix.authenticate("owner")
    assert matrix.client.delete(f"/api/v1/shares/{created.json()['id']}").status_code == 204
    matrix.authenticate("editor")
    for suffix in ["", "/download", "/preview"]:
        assert matrix.client.get(path + suffix).status_code == 404


@pytest.mark.parametrize("actor", ACTORS)
@pytest.mark.parametrize("operation", ["detail", "children", "download", "preview"])
@pytest.mark.parametrize("link_state", ["active", "outside", "expired", "revoked", "trash"])
def test_public_token_scope_is_independent_of_session(matrix, actor, operation, link_state):
    folder_request = operation in {"detail", "children"}
    target = matrix.folder if folder_request else matrix.file
    root = matrix.scope if matrix.inherited else target
    link = ShareLink.objects.create(node=root, created_by=matrix.users["owner"])
    if link_state == "outside":
        target = Node.objects.create(
            owner=matrix.users["owner"],
            parent=matrix.users["owner"].root_folder,
            name="Outside",
            kind="folder" if folder_request else "file",
        )
    elif link_state == "expired":
        ShareLink.objects.filter(pk=link.pk).update(expires_at=timezone.now())
    elif link_state == "revoked":
        matrix.authenticate("owner")
        assert matrix.client.delete(f"/api/v1/links/{link.pk}").status_code == 204
    elif link_state == "trash":
        trash(matrix.users["owner"], [target.pk])
    matrix.authenticate(actor)
    before = state()
    suffix = "" if operation == "detail" else f"/{operation}"
    query = {"folder_id" if operation == "children" else "node_id": str(target.pk)}
    response = matrix.client.get(f"/api/v1/public/links/{link.token}{suffix}", query)
    assert response.status_code == (200 if link_state == "active" else 404), response.json()
    assert state() == before
    if link_state != "active":
        unknown = matrix.client.get(f"/api/v1/public/links/unknown{suffix}", query)
        assert response.json() == unknown.json()
    elif operation == "detail":
        body = response.json()
        assert body["id"] == str(target.pk)
        assert not any(body["capabilities"].values())
        assert [crumb["id"] for crumb in body["breadcrumb"]] == (
            [str(matrix.scope.pk)] if matrix.inherited else []
        )
        assert "owner" not in body
    elif operation == "children":
        assert [node["id"] for node in response.json()["results"]] == [str(matrix.child.pk)]
    else:
        assert "X-Amz-Signature=" in response.json()["url"]


@pytest.mark.parametrize("actor", ACTORS)
@pytest.mark.parametrize("kind", ["folder", "file"])
def test_link_management_is_owner_only_on_direct_and_inherited_nodes(matrix, actor, kind):
    node = matrix.folder if kind == "folder" else matrix.file
    link = ShareLink.objects.create(node=node, created_by=matrix.users["owner"])
    matrix.authenticate(actor)
    before = state()
    path = f"/api/v1/nodes/{node.pk}/links"
    listed = matrix.client.get(path)
    created = matrix.client.post(path, {}, format="json")
    revoked = matrix.client.delete(f"/api/v1/links/{link.pk}")
    if actor == "owner":
        assert listed.status_code == 200
        assert [row["id"] for row in listed.json()["results"]] == [str(link.pk)]
        assert created.status_code == 201
        link.refresh_from_db()
        assert revoked.status_code == 204
        assert link.revoked_at is not None
        assert link.revoked_by_id == matrix.users["owner"].pk
        assert link.revoke_reason == "owner"
        assert ShareLink.objects.get(pk=created.json()["id"]).revoked_at is None
    else:
        expected = 403 if actor is None else 404
        assert [listed.status_code, created.status_code, revoked.status_code] == [expected] * 3
        assert state() == before
